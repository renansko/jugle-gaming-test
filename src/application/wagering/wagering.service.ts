import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { LockMode } from "@mikro-orm/core";
import { type EntityManager, MikroORM } from "@mikro-orm/postgresql";
import { DomainError } from "../../domain/shared/domain-error";
import { Money } from "../../domain/shared/money";
import type { Wallet } from "../../domain/wallet/wallet";
import {
  WagerTransaction,
  type WagerTransactionKind,
} from "../../domain/wagering/wager-transaction";
import { InboxMessage } from "../../domain/messaging/inbox-message";
import { OutboxMessage } from "../../domain/messaging/outbox-message";
import { WalletLedgerEntryEntity } from "../../infrastructure/persistence/entities/wallet-ledger-entry.entity";
import { WagerTransactionEntity } from "../../infrastructure/persistence/entities/wager-transaction.entity";
import { WalletEntity } from "../../infrastructure/persistence/entities/wallet.entity";
import { OutboxMessageEntity } from "../../infrastructure/persistence/entities/outbox-message.entity";
import { InboxMessageEntity } from "../../infrastructure/persistence/entities/inbox-message.entity";
import {
  wagerTransactionToDomain,
  wagerTransactionToPersistence,
} from "../../infrastructure/persistence/mappers/wager-transaction.mapper";
import {
  walletToDomain,
  walletToPersistence,
} from "../../infrastructure/persistence/mappers/wallet.mapper";
import { walletLedgerEntryToPersistence } from "../../infrastructure/persistence/mappers/wallet-ledger-entry.mapper";
import { inboxMessageToPersistence } from "../../infrastructure/persistence/mappers/inbox-message.mapper";
import { outboxMessageToPersistence } from "../../infrastructure/persistence/mappers/outbox-message.mapper";
import {
  WalletBalanceChanged,
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
} from "../../domain/messaging/integration-event";
import { canonicalWagerPayloadHash } from "./canonical-payload";
import { OperationalMetrics } from "../../infrastructure/observability/operational-metrics";
import { type Clock, SystemClock } from "../../domain/common/clock";
import {
  CryptoIdGenerator,
  type IdGenerator,
} from "../../domain/common/id-generator";
import {
  type BackoffPolicy,
  DefaultBackoffPolicy,
} from "../../domain/common/backoff-policy";

export type WagerKind = "BET" | "WIN" | "LOSS" | "REFUND" | "ROLLBACK";

export interface ProcessWagerInput {
  idempotencyKey: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  currency: string;
  amount: string;
  kind: WagerKind;
  roundId: string;
  gameId?: string;
  referenceExternalTransactionId?: string;
}

export interface ProcessWagerOutput {
  id: string;
  transactionId: string;
  status: string;
  failureCode?: string;
  gameId?: string;
  balance: {
    amount: string;
    currency: string;
  };
  idempotentReplay: boolean;
}

export interface InboxContext {
  consumerName: string;
  messageId: string;
  payloadHash: string;
}

export interface WageringContext {
  correlationId?: string;
  causationId?: string;
  inbox?: InboxContext;
}

export interface WageringExecutionHooks {
  beforeLock?: (input: ProcessWagerInput) => Promise<void> | void;
  afterLock?: (input: ProcessWagerInput) => Promise<void> | void;
  beforeApply?: (input: ProcessWagerInput) => Promise<void> | void;
  beforeFlush?: (input: ProcessWagerInput) => Promise<void> | void;
}

type ValidPendingTransaction = WagerTransactionEntity & {
  walletId: string;
  playerId: string;
  currency: string;
  amount: string;
  roundId: string;
};

/** @wiki docs/brain/services/WageringService.md */
@Injectable()
export class WageringService {
  private readonly logger = new Logger(WageringService.name);

  public constructor(
    @Inject(MikroORM)
    private readonly orm: MikroORM,
    @Inject(OperationalMetrics)
    private readonly metrics: OperationalMetrics,
    @Optional()
    private readonly clock: Clock = new SystemClock(),
    @Optional()
    private readonly idGenerator: IdGenerator = new CryptoIdGenerator(),
    @Optional()
    private readonly backoffPolicy: BackoffPolicy = new DefaultBackoffPolicy(),
    @Optional()
    private readonly hooks?: WageringExecutionHooks,
  ) {}

  public async execute(
    input: ProcessWagerInput,
    context: WageringContext = {},
  ): Promise<ProcessWagerOutput> {
    const startedAt = this.clock.nowMs();
    const amount = Money.create(input.amount, input.currency);
    const payloadHash = canonicalWagerPayloadHash({
      ...input,
      amount: amount.amount,
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.orm.em.transactional((entityManager) =>
          this.executeTransactionBlock(
            entityManager,
            input,
            amount,
            payloadHash,
            context,
            startedAt,
          ),
        );
      } catch (error) {
        const retryResult = await this.handleTransactionError(
          error,
          attempt,
          input,
          payloadHash,
          startedAt,
        );
        if (retryResult) {
          return retryResult;
        }
      }
    }

    throw new DomainError(
      "DEPENDENCY_UNAVAILABLE",
      "Transaction contention exceeded retry limit",
    );
  }

  private async executeTransactionBlock(
    entityManager: EntityManager,
    input: ProcessWagerInput,
    amount: Money,
    payloadHash: string,
    context: WageringContext,
    startedAt: number,
  ): Promise<ProcessWagerOutput> {
    const existingInbox = await this.checkInbox(entityManager, context.inbox);
    const existingOutput = await this.checkExistingIdempotentTransaction(
      entityManager,
      input,
      payloadHash,
      context,
      existingInbox,
      startedAt,
    );
    if (existingOutput) {
      return existingOutput;
    }

    if (existingInbox) {
      throw new DomainError(
        "DEPENDENCY_UNAVAILABLE",
        "Inbox exists without its financial transaction",
      );
    }

    await this.hooks?.beforeLock?.(input);
    const walletEntity = await this.lockWallet(entityManager, input.walletId);
    await this.hooks?.afterLock?.(input);

    const wallet = walletToDomain(walletEntity);
    const domainTransaction = this.createInitialTransaction(
      input,
      amount,
      payloadHash,
    );

    const transactionEntity = entityManager.create(
      WagerTransactionEntity,
      wagerTransactionToPersistence(domainTransaction),
    );
    entityManager.persist(transactionEntity);
    await entityManager.flush();

    await this.hooks?.beforeApply?.(input);
    await this.processWagerMovement(
      entityManager,
      domainTransaction,
      wallet,
      amount,
      input,
    );

    walletToPersistence(wallet, walletEntity);
    wagerTransactionToPersistence(domainTransaction, transactionEntity);

    this.stageEvents(entityManager, domainTransaction, wallet, context);
    if (context.inbox) {
      this.stageInbox(entityManager, context.inbox);
    }

    await this.hooks?.beforeFlush?.(input);
    await entityManager.flush();

    this.logWagerEvent("wager_completed", domainTransaction, context);
    return this.recordOutput(domainTransaction, false, startedAt);
  }

  private async checkInbox(
    entityManager: EntityManager,
    inbox?: InboxContext,
  ): Promise<InboxMessageEntity | null> {
    if (!inbox) {
      return null;
    }

    const existingInbox = await entityManager.findOne(InboxMessageEntity, {
      consumerName: inbox.consumerName,
      messageId: inbox.messageId,
    });

    if (existingInbox && existingInbox.payloadHash !== inbox.payloadHash) {
      throw new DomainError(
        "MESSAGE_PERMANENT_FAILURE",
        "Message id was reused with a different payload",
      );
    }

    return existingInbox;
  }

  private async checkExistingIdempotentTransaction(
    entityManager: EntityManager,
    input: ProcessWagerInput,
    payloadHash: string,
    context: WageringContext,
    existingInbox: InboxMessageEntity | null,
    startedAt: number,
  ): Promise<ProcessWagerOutput | null> {
    const existingEntity =
      (await entityManager.findOne(WagerTransactionEntity, {
        idempotencyKey: input.idempotencyKey,
      })) ??
      (await entityManager.findOne(WagerTransactionEntity, {
        providerId: input.providerId,
        externalTransactionId: input.externalTransactionId,
      }));

    if (!existingEntity) {
      return null;
    }

    if (existingEntity.payloadHash !== payloadHash) {
      throw new DomainError(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was already used for another payload",
      );
    }

    if (context.inbox && !existingInbox) {
      this.stageInbox(entityManager, context.inbox);
    }

    await entityManager.flush();

    const domainExisting = wagerTransactionToDomain(existingEntity);
    this.logWagerEvent("wager_replay", domainExisting, context);
    return this.recordOutput(domainExisting, true, startedAt);
  }

  private async lockWallet(
    entityManager: EntityManager,
    walletId: string,
  ): Promise<WalletEntity> {
    const lockStartedAt = this.clock.nowMs();
    const walletEntity = await entityManager.findOne(
      WalletEntity,
      { id: walletId },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    this.metrics.observe(
      "wallet_lock_duration_ms",
      this.clock.nowMs() - lockStartedAt,
    );

    if (!walletEntity) {
      throw new DomainError("WALLET_NOT_FOUND", "Wallet not found");
    }

    return walletEntity;
  }

  private createInitialTransaction(
    input: ProcessWagerInput,
    amount: Money,
    payloadHash: string,
  ): WagerTransaction {
    const now = this.clock.now();
    return WagerTransaction.create({
      id: this.idGenerator.generate(),
      idempotencyKey: input.idempotencyKey,
      providerId: input.providerId,
      externalTransactionId: input.externalTransactionId,
      payloadHash,
      walletId: input.walletId,
      playerId: input.playerId,
      money: amount,
      kind: input.kind,
      roundId: input.roundId,
      gameId: input.gameId,
      referenceExternalTransactionId: input.referenceExternalTransactionId,
      status: "PENDING",
      createdAt: now,
      updatedAt: now,
    });
  }

  private async processWagerMovement(
    entityManager: EntityManager,
    transaction: WagerTransaction,
    wallet: Wallet,
    amount: Money,
    input: ProcessWagerInput,
  ): Promise<void> {
    if (wallet.playerId !== input.playerId) {
      transaction.markRejected(
        "REFERENCE_SCOPE_MISMATCH",
        wallet.balance,
        this.clock.now(),
      );
      return;
    }

    if (wallet.currency !== input.currency) {
      transaction.markRejected(
        "CURRENCY_MISMATCH",
        wallet.balance,
        this.clock.now(),
      );
      return;
    }

    await this.apply(entityManager, transaction, wallet, amount, input);
  }

  private async handleTransactionError(
    error: unknown,
    attempt: number,
    input: ProcessWagerInput,
    payloadHash: string,
    startedAt: number,
  ): Promise<ProcessWagerOutput | null> {
    if (this.isReferenceUniqueViolation(error)) {
      throw new DomainError(
        "REFERENCE_ALREADY_REVERSED",
        "Reference was already reversed by this operation type",
      );
    }

    if (this.isUniqueViolation(error)) {
      return this.handleIdempotencyConflict(input, payloadHash, startedAt);
    }

    if (this.isRetryableTransactionError(error)) {
      return this.handleRetryableContention(error, attempt, input);
    }

    throw error;
  }

  private async handleRetryableContention(
    error: unknown,
    attempt: number,
    input: ProcessWagerInput,
  ): Promise<null> {
    const isDeadlock = this.isDeadlockError(error);
    this.metrics.increment("lock_retries_total", {
      reason: isDeadlock ? "deadlock" : "serialization_failure",
    });
    if (isDeadlock) {
      this.metrics.increment("deadlocks_total");
    }
    this.metrics.increment("lock_contention_total");

    this.logger.warn(
      JSON.stringify({
        event: "lock_retry",
        attempt,
        reason: isDeadlock ? "deadlock" : "serialization_failure",
        walletId: input.walletId,
        providerId: input.providerId,
      }),
    );

    if (attempt < 2) {
      await this.retryDelay(attempt);
      return null;
    }

    return null;
  }

  private isDeadlockError(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "40P01"
    );
  }

  private async handleIdempotencyConflict(
    input: ProcessWagerInput,
    payloadHash: string,
    startedAt: number,
  ): Promise<ProcessWagerOutput | null> {
    const savedEntity = await this.findPersistedTransaction(input);
    if (!savedEntity) {
      return null;
    }
    if (savedEntity.payloadHash !== payloadHash) {
      throw new DomainError(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was already used for another payload",
      );
    }
    const savedDomain = wagerTransactionToDomain(savedEntity);
    return this.recordOutput(savedDomain, true, startedAt);
  }

  public async get(id: string): Promise<Record<string, unknown> | null> {
    const transaction = await this.orm.em
      .fork()
      .findOne(WagerTransactionEntity, { id });
    return transaction ? this.serializeTransaction(transaction) : null;
  }

  public async getByProvider(
    providerId: string,
    externalTransactionId: string,
  ): Promise<Record<string, unknown> | null> {
    const transaction = await this.orm.em
      .fork()
      .findOne(WagerTransactionEntity, {
        providerId,
        externalTransactionId,
      });
    return transaction ? this.serializeTransaction(transaction) : null;
  }

  private serializeTransaction(
    transaction: WagerTransactionEntity,
  ): Record<string, unknown> {
    return {
      id: transaction.id,
      transactionId: transaction.id,
      providerId: transaction.providerId,
      externalTransactionId: transaction.externalTransactionId,
      walletId: transaction.walletId,
      playerId: transaction.playerId,
      kind: transaction.kind,
      roundId: transaction.roundId,
      gameId: transaction.gameId,
      status: transaction.status,
      failureCode: transaction.failureCode,
      amount: transaction.amount,
      currency: transaction.currency,
      balance: {
        amount: transaction.observedBalance ?? "0.00",
        currency: transaction.currency ?? "XXX",
      },
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
    };
  }

  public async resolvePendingReference(
    id: string,
    context: WageringContext = {},
  ): Promise<"resolved" | "still_pending" | "ignored"> {
    return this.orm.em.transactional(async (entityManager) => {
      const transactionEntity = await entityManager.findOne(
        WagerTransactionEntity,
        { id },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );

      if (!this.isValidPendingTransaction(transactionEntity)) {
        return "ignored";
      }

      const walletEntity = await entityManager.findOne(
        WalletEntity,
        { id: transactionEntity.walletId },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );

      if (!walletEntity) {
        return "ignored";
      }

      const domainTransaction = wagerTransactionToDomain(transactionEntity);
      const domainWallet = walletToDomain(walletEntity);

      await this.apply(
        entityManager,
        domainTransaction,
        domainWallet,
        domainTransaction.money ??
          Money.create(transactionEntity.amount, transactionEntity.currency),
        {
          idempotencyKey: transactionEntity.idempotencyKey,
          providerId: transactionEntity.providerId,
          externalTransactionId: transactionEntity.externalTransactionId,
          walletId: transactionEntity.walletId,
          playerId: transactionEntity.playerId,
          currency: transactionEntity.currency,
          amount: transactionEntity.amount,
          kind: transactionEntity.kind as WagerKind,
          roundId: transactionEntity.roundId,
          gameId: transactionEntity.gameId,
          referenceExternalTransactionId:
            transactionEntity.referenceExternalTransactionId,
        },
      );

      walletToPersistence(domainWallet, walletEntity);
      wagerTransactionToPersistence(domainTransaction, transactionEntity);

      if (domainTransaction.status === "PENDING_REFERENCE") {
        domainTransaction.clearReferenceLease();
        wagerTransactionToPersistence(domainTransaction, transactionEntity);
        await entityManager.flush();
        return "still_pending";
      }

      domainTransaction.clearReferenceAttempt();
      wagerTransactionToPersistence(domainTransaction, transactionEntity);
      this.stageEvents(entityManager, domainTransaction, domainWallet, context);
      await entityManager.flush();

      this.logWagerEvent("wager_resolved", domainTransaction, context);
      return "resolved";
    });
  }

  public async expirePendingReference(
    id: string,
    context: WageringContext = {},
  ): Promise<boolean> {
    return this.orm.em.transactional(async (entityManager) => {
      const transactionEntity = await entityManager.findOne(
        WagerTransactionEntity,
        { id },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );

      if (
        !transactionEntity ||
        transactionEntity.status !== "PENDING_REFERENCE"
      ) {
        return false;
      }

      const walletEntity = transactionEntity.walletId
        ? await entityManager.findOne(WalletEntity, {
            id: transactionEntity.walletId,
          })
        : null;

      if (!walletEntity) {
        return false;
      }

      const domainTransaction = wagerTransactionToDomain(transactionEntity);
      const domainWallet = walletToDomain(walletEntity);

      domainTransaction.markRejected(
        "REFERENCE_NOT_FOUND",
        domainWallet.balance,
        this.clock.now(),
      );
      domainTransaction.clearReferenceAttempt();

      wagerTransactionToPersistence(domainTransaction, transactionEntity);
      this.stageEvents(entityManager, domainTransaction, domainWallet, context);
      await entityManager.flush();

      this.logWagerEvent("wager_expired", domainTransaction, context);
      return true;
    });
  }

  private hasRequiredTransactionFields(
    transaction: WagerTransactionEntity,
  ): transaction is ValidPendingTransaction {
    if (!transaction.walletId || !transaction.playerId) {
      return false;
    }
    if (!transaction.currency || !transaction.amount) {
      return false;
    }
    return Boolean(transaction.roundId);
  }

  private isValidPendingTransaction(
    transaction: WagerTransactionEntity | null,
  ): transaction is ValidPendingTransaction {
    if (!transaction) {
      return false;
    }
    if (transaction.status !== "PENDING_REFERENCE") {
      return false;
    }
    return this.hasRequiredTransactionFields(transaction);
  }

  private shouldResolveReference(kind: string, hasReference: boolean): boolean {
    if (kind === "REFUND" || kind === "ROLLBACK") {
      return true;
    }
    return kind === "WIN" && hasReference;
  }

  private isDebitOperation(kind: string, referenceKind?: string): boolean {
    if (kind === "BET") {
      return true;
    }
    return kind === "ROLLBACK" && referenceKind !== "BET";
  }

  private handleInsufficientFunds(
    error: unknown,
    transaction: WagerTransaction,
    wallet: Wallet,
    kind: string,
  ): void {
    if (error instanceof DomainError && error.code === "INSUFFICIENT_FUNDS") {
      const code =
        kind === "BET" ? "INSUFFICIENT_FUNDS" : "REVERSAL_WOULD_NEGATIVE";
      transaction.markRejected(code, wallet.balance, this.clock.now());
      return;
    }
    throw error;
  }

  private mutateWalletBalance(
    entityManager: EntityManager,
    wallet: Wallet,
    transactionId: string,
    amount: Money,
    isDebit: boolean,
  ): void {
    const entryId = this.idGenerator.generate();
    const entry = isDebit
      ? wallet.debit(amount, transactionId, entryId)
      : wallet.credit(amount, transactionId, entryId);

    const ledgerEntity = entityManager.create(
      WalletLedgerEntryEntity,
      walletLedgerEntryToPersistence(entry),
    );

    entityManager.persist(ledgerEntity);
  }

  private async apply(
    entityManager: EntityManager,
    transaction: WagerTransaction,
    wallet: Wallet,
    amount: Money,
    input: ProcessWagerInput,
  ): Promise<void> {
    if (input.kind === "LOSS") {
      transaction.markProcessed(wallet.balance, this.clock.now());
      return;
    }

    const reference = await this.prepareReference(
      entityManager,
      transaction,
      wallet,
      amount,
      input,
    );
    if (!reference && this.shouldResolveReference(input.kind, Boolean(input.referenceExternalTransactionId))) {
      return;
    }

    this.executeWalletMovement(
      entityManager,
      transaction,
      wallet,
      amount,
      input.kind,
      reference ? reference.kind : undefined,
    );
  }

  private async prepareReference(
    entityManager: EntityManager,
    transaction: WagerTransaction,
    wallet: Wallet,
    amount: Money,
    input: ProcessWagerInput,
  ): Promise<WagerTransaction | null> {
    const hasRef = Boolean(input.referenceExternalTransactionId);
    if (!this.shouldResolveReference(input.kind, hasRef)) {
      return null;
    }
    return this.resolveAndValidateReference(
      entityManager,
      transaction,
      wallet,
      amount,
      input,
    );
  }

  private executeWalletMovement(
    entityManager: EntityManager,
    transaction: WagerTransaction,
    wallet: Wallet,
    amount: Money,
    kind: string,
    referenceKind?: string,
  ): void {
    try {
      const isDebit = this.isDebitOperation(kind, referenceKind);
      const txId = transaction.id ? transaction.id : "";
      this.mutateWalletBalance(
        entityManager,
        wallet,
        txId,
        amount,
        isDebit,
      );
      transaction.markProcessed(wallet.balance, this.clock.now());
    } catch (error) {
      this.handleInsufficientFunds(error, transaction, wallet, kind);
    }
  }

  private async resolveAndValidateReference(
    entityManager: EntityManager,
    transaction: WagerTransaction,
    wallet: Wallet,
    amount: Money,
    input: ProcessWagerInput,
  ): Promise<WagerTransaction | null> {
    const referenceEntity = await this.findReferenceTransaction(
      entityManager,
      input,
    );
    if (!referenceEntity) {
      transaction.markPendingReference(this.clock.now(), this.clock.now());
      return null;
    }

    const reference = wagerTransactionToDomain(referenceEntity);
    const refId = reference.id ? reference.id : "";
    transaction.linkReference(refId);

    if (!this.validateReferenceRules(transaction, wallet, reference, amount, input)) {
      return null;
    }

    const isDuplicate = await this.checkDuplicateReversal(
      entityManager,
      transaction,
      wallet,
      refId,
      input.kind,
    );
    if (isDuplicate) {
      return null;
    }

    return reference;
  }

  private async checkDuplicateReversal(
    entityManager: EntityManager,
    transaction: WagerTransaction,
    wallet: Wallet,
    referenceId: string,
    kind: WagerKind,
  ): Promise<boolean> {
    const txId = transaction.id ? transaction.id : "";
    const isDuplicate = await this.isAlreadyReversed(
      entityManager,
      referenceId,
      kind,
      txId,
    );
    if (isDuplicate) {
      transaction.markRejected(
        "REFERENCE_ALREADY_REVERSED",
        wallet.balance,
        this.clock.now(),
      );
      return true;
    }
    return false;
  }

  private async findReferenceTransaction(
    entityManager: EntityManager,
    input: ProcessWagerInput,
  ): Promise<WagerTransactionEntity | null> {
    const extId = input.referenceExternalTransactionId;
    if (!extId) {
      return null;
    }

    const byProvider = await entityManager.findOne(WagerTransactionEntity, {
      providerId: input.providerId,
      externalTransactionId: extId,
    });
    if (byProvider) {
      return byProvider;
    }

    return entityManager.findOne(WagerTransactionEntity, {
      externalTransactionId: extId,
    });
  }

  private validateReferenceRules(
    transaction: WagerTransaction,
    wallet: Wallet,
    reference: WagerTransaction,
    amount: Money,
    input: ProcessWagerInput,
  ): boolean {
    if (reference.status !== "PROCESSED") {
      transaction.markRejected(
        "REFERENCE_NOT_PROCESSED",
        wallet.balance,
        this.clock.now(),
      );
      return false;
    }

    if (!this.matchesScope(reference, input)) {
      transaction.markRejected(
        "REFERENCE_SCOPE_MISMATCH",
        wallet.balance,
        this.clock.now(),
      );
      return false;
    }

    if (
      this.isAmountMismatch(input.kind, reference.money?.amount, amount.amount)
    ) {
      transaction.markRejected(
        "REFERENCE_AMOUNT_MISMATCH",
        wallet.balance,
        this.clock.now(),
      );
      return false;
    }

    if (this.isInvalidReferenceKind(input.kind, reference.kind ?? "")) {
      transaction.markRejected(
        "INVALID_REFERENCE_KIND",
        wallet.balance,
        this.clock.now(),
      );
      return false;
    }

    return true;
  }

  private async isAlreadyReversed(
    entityManager: EntityManager,
    referenceId: string,
    kind: WagerKind,
    currentTransactionId: string,
  ): Promise<boolean> {
    const isReversal = kind === "REFUND" || kind === "ROLLBACK";
    if (!isReversal) {
      return false;
    }

    const existing = await entityManager.findOne(WagerTransactionEntity, {
      referenceTransactionId: referenceId,
      kind,
      status: { $in: ["PENDING", "PENDING_REFERENCE", "PROCESSED"] },
      id: { $ne: currentTransactionId },
    });
    return existing !== null;
  }

  private matchesScope(
    reference: WagerTransaction,
    input: ProcessWagerInput,
  ): boolean {
    const providerMatches =
      !reference.providerId || reference.providerId === input.providerId;
    const playerMatches = reference.playerId === input.playerId;
    const walletMatches = reference.walletId === input.walletId;
    const currencyMatches = reference.money?.currency === input.currency;
    const roundMatches = reference.roundId === input.roundId;
    return (
      providerMatches &&
      playerMatches &&
      walletMatches &&
      currencyMatches &&
      roundMatches
    );
  }

  private isAmountMismatch(
    kind: WagerKind,
    referenceAmount: string | undefined,
    inputAmount: string,
  ): boolean {
    if (kind === "WIN") {
      return false;
    }
    return referenceAmount !== inputAmount;
  }

  private isInvalidReferenceKind(
    kind: WagerKind,
    referenceKind: string,
  ): boolean {
    if (kind === "REFUND" || kind === "WIN") {
      return referenceKind !== "BET";
    }
    if (kind === "ROLLBACK") {
      return !["BET", "WIN", "REFUND"].includes(referenceKind);
    }
    return false;
  }

  private stageInbox(entityManager: EntityManager, inbox: InboxContext): void {
    const inboxMessage = InboxMessage.create({
      id: this.idGenerator.generate(),
      consumerName: inbox.consumerName,
      messageId: inbox.messageId,
      payloadHash: inbox.payloadHash,
      processedAt: this.clock.now(),
    });
    const inboxEntity = entityManager.create(
      InboxMessageEntity,
      inboxMessageToPersistence(inboxMessage),
    );
    entityManager.persist(inboxEntity);
  }

  private stageEvents(
    entityManager: EntityManager,
    transaction: WagerTransaction,
    wallet: Wallet,
    context: WageringContext,
  ): void {
    const txId = transaction.id ?? "";
    const correlationId = context.correlationId ?? txId;
    const eventData = {
      transactionId: txId,
      status: transaction.status,
      failureCode: transaction.failureCode,
      balance: {
        amount: wallet.balance.amount,
        currency: wallet.currency,
      },
    };

    const event = this.buildWagerEvent(transaction, correlationId, eventData);
    event.envelope.causationId = context.causationId;

    const outboxMessage = OutboxMessage.create({
      id: event.envelope.eventId,
      eventType: `${event.envelope.eventType}.v1`,
      payload: event.envelope,
      attemptCount: 0,
      nextAttemptAt: this.clock.now(),
      createdAt: this.clock.now(),
    });
    const outboxEntity = entityManager.create(
      OutboxMessageEntity,
      outboxMessageToPersistence(outboxMessage),
    );
    entityManager.persist(outboxEntity);

    this.stageBalanceChangedEvent(
      entityManager,
      transaction,
      wallet,
      correlationId,
      context.causationId,
    );
  }

  private buildWagerEvent(
    transaction: WagerTransaction,
    correlationId: string,
    eventData: {
      transactionId: string;
      status: string;
      failureCode?: string;
      balance: { amount: string; currency: string };
    },
  ):
    | WagerTransactionRejected
    | WagerTransactionPendingReference
    | WagerTransactionProcessed {
    const txId = transaction.id ?? "";
    if (transaction.status === "REJECTED") {
      return new WagerTransactionRejected(
        txId,
        correlationId,
        eventData,
      );
    }
    if (transaction.status === "PENDING_REFERENCE") {
      return new WagerTransactionPendingReference(
        txId,
        correlationId,
        eventData,
      );
    }
    return new WagerTransactionProcessed(
      txId,
      correlationId,
      eventData,
    );
  }

  private stageBalanceChangedEvent(
    entityManager: EntityManager,
    transaction: WagerTransaction,
    wallet: Wallet,
    correlationId: string,
    causationId?: string,
  ): void {
    if (transaction.status !== "PROCESSED" || transaction.kind === "LOSS") {
      return;
    }

    const balanceEvent = new WalletBalanceChanged(wallet.id, correlationId, {
      walletId: wallet.id,
      balance: {
        amount: wallet.balance.amount,
        currency: wallet.currency,
      },
      transactionId: transaction.id ?? "",
    });

    balanceEvent.envelope.causationId = causationId;

    const balanceOutboxMessage = OutboxMessage.create({
      id: balanceEvent.envelope.eventId,
      eventType: "WalletBalanceChanged.v1",
      payload: balanceEvent.envelope,
      attemptCount: 0,
      nextAttemptAt: this.clock.now(),
      createdAt: this.clock.now(),
    });
    const balanceEntity = entityManager.create(
      OutboxMessageEntity,
      outboxMessageToPersistence(balanceOutboxMessage),
    );
    entityManager.persist(balanceEntity);
  }

  private output(
    transaction: WagerTransaction,
    idempotentReplay: boolean,
  ): ProcessWagerOutput {
    return {
      id: transaction.id ?? "",
      transactionId: transaction.id ?? "",
      status: transaction.status,
      failureCode: transaction.failureCode,
      gameId: transaction.gameId,
      balance: {
        amount: transaction.observedBalance?.amount ?? "0.00",
        currency: transaction.money?.currency ?? "XXX",
      },
      idempotentReplay,
    };
  }

  private recordOutput(
    transaction: WagerTransaction,
    isReplay: boolean,
    startedAt: number,
  ): ProcessWagerOutput {
    this.metrics.increment("wager_transactions_total", {
      kind: transaction.kind ?? "BET",
      status: transaction.status,
      failureCode: transaction.failureCode ?? "none",
    });

    if (isReplay) {
      this.metrics.increment("idempotency_replays_total");
    }

    this.metrics.observe(
      "wager_processing_latency_ms",
      this.clock.nowMs() - startedAt,
      {
        channel: "application",
      },
    );

    return this.output(transaction, isReplay);
  }

  private logWagerEvent(
    event: string,
    transaction: WagerTransaction,
    context: WageringContext,
    extra: Record<string, unknown> = {},
  ): void {
    this.logger.log(
      JSON.stringify({
        event,
        correlationId: context.correlationId ?? transaction.id,
        messageId: context.inbox?.messageId,
        transactionId: transaction.id,
        walletId: transaction.walletId,
        providerId: transaction.providerId,
        status: transaction.status,
        failureCode: transaction.failureCode,
        ...extra,
      }),
    );
  }

  private async findPersistedTransaction(
    input: ProcessWagerInput,
  ): Promise<WagerTransactionEntity | null> {
    const forkEntityManager = this.orm.em.fork();
    const byKey = await forkEntityManager.findOne(WagerTransactionEntity, {
      idempotencyKey: input.idempotencyKey,
    });
    if (byKey) return byKey;

    return forkEntityManager.findOne(WagerTransactionEntity, {
      providerId: input.providerId,
      externalTransactionId: input.externalTransactionId,
    });
  }

  private async retryDelay(attempt: number): Promise<void> {
    const delayMs = this.backoffPolicy.computeDelayMs(attempt, 20, 20);
    await this.backoffPolicy.delay(delayMs);
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    );
  }

  private isRetryableTransactionError(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error.code === "40001" || error.code === "40P01")
    );
  }

  private isReferenceUniqueViolation(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "constraint" in error &&
      error.constraint === "wager_transactions_reference_kind_unique"
    );
  }
}
