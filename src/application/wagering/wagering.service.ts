import { Inject, Injectable } from "@nestjs/common";
import { LockMode } from "@mikro-orm/core";
import { type EntityManager, MikroORM } from "@mikro-orm/postgresql";
import { DomainError } from "../../domain/shared/domain-error";
import { Money } from "../../domain/shared/money";
import { Wallet } from "../../domain/wallet/wallet";
import { WalletLedgerEntryEntity } from "../../infrastructure/persistence/entities/wallet-ledger-entry.entity";
import { WagerTransactionEntity } from "../../infrastructure/persistence/entities/wager-transaction.entity";
import { WalletEntity } from "../../infrastructure/persistence/entities/wallet.entity";
import { OutboxMessageEntity } from "../../infrastructure/persistence/entities/outbox-message.entity";
import { InboxMessageEntity } from "../../infrastructure/persistence/entities/inbox-message.entity";
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

/** @wiki docs/brain/services/WageringService.md */
@Injectable()
export class WageringService {
  public constructor(
    @Inject(MikroORM)
    private readonly orm: MikroORM,
    @Inject(OperationalMetrics)
    private readonly metrics: OperationalMetrics,
    private readonly clock: Clock = new SystemClock(),
    private readonly idGenerator: IdGenerator = new CryptoIdGenerator(),
    private readonly backoffPolicy: BackoffPolicy = new DefaultBackoffPolicy(),
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
        return await this.orm.em.transactional(async (entityManager) => {
          const existingInbox = await this.checkInbox(
            entityManager,
            context.inbox,
          );

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
          const walletEntity = await this.lockWallet(
            entityManager,
            input.walletId,
          );
          await this.hooks?.afterLock?.(input);

          const wallet = Wallet.rehydrate({
            ...walletEntity,
            balance: Money.create(walletEntity.balance, walletEntity.currency),
          });

          const transaction = this.createInitialTransaction(
            entityManager,
            input,
            amount,
            payloadHash,
          );
          entityManager.persist(transaction);
          await entityManager.flush();

          await this.hooks?.beforeApply?.(input);
          await this.processWagerMovement(
            entityManager,
            transaction,
            wallet,
            amount,
            input,
          );

          if (transaction.status === "PENDING_REFERENCE") {
            transaction.nextReferenceAttemptAt = this.clock.now();
          }

          walletEntity.balance = wallet.balance.amount;
          walletEntity.version = wallet.version;
          walletEntity.updatedAt = wallet.updatedAt;
          transaction.observedBalance = wallet.balance.amount;

          this.stageEvents(entityManager, transaction, wallet, context);
          if (context.inbox) {
            this.stageInbox(entityManager, context.inbox);
          }

          await this.hooks?.beforeFlush?.(input);
          await entityManager.flush();
          return this.recordOutput(transaction, false, startedAt);
        });
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
    const existingTransaction =
      (await entityManager.findOne(WagerTransactionEntity, {
        idempotencyKey: input.idempotencyKey,
      })) ??
      (await entityManager.findOne(WagerTransactionEntity, {
        providerId: input.providerId,
        externalTransactionId: input.externalTransactionId,
      }));

    if (!existingTransaction) {
      return null;
    }

    if (existingTransaction.payloadHash !== payloadHash) {
      throw new DomainError(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was already used for another payload",
      );
    }

    if (context.inbox && !existingInbox) {
      this.stageInbox(entityManager, context.inbox);
    }

    await entityManager.flush();
    return this.recordOutput(existingTransaction, true, startedAt);
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
    entityManager: EntityManager,
    input: ProcessWagerInput,
    amount: Money,
    payloadHash: string,
  ): WagerTransactionEntity {
    const now = this.clock.now();
    return entityManager.create(WagerTransactionEntity, {
      id: this.idGenerator.generate(),
      idempotencyKey: input.idempotencyKey,
      providerId: input.providerId,
      externalTransactionId: input.externalTransactionId,
      payloadHash,
      walletId: input.walletId,
      playerId: input.playerId,
      currency: input.currency,
      amount: amount.amount,
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
    transaction: WagerTransactionEntity,
    wallet: Wallet,
    amount: Money,
    input: ProcessWagerInput,
  ): Promise<void> {
    if (wallet.playerId !== input.playerId) {
      this.reject(transaction, wallet, "REFERENCE_SCOPE_MISMATCH");
      return;
    }

    if (wallet.currency !== input.currency) {
      this.reject(transaction, wallet, "CURRENCY_MISMATCH");
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
      const savedTransaction = await this.findPersistedTransaction(input);
      if (savedTransaction) {
        if (savedTransaction.payloadHash !== payloadHash) {
          throw new DomainError(
            "IDEMPOTENCY_CONFLICT",
            "Idempotency key was already used for another payload",
          );
        }
        return this.recordOutput(savedTransaction, true, startedAt);
      }
      return null;
    }

    if (this.isRetryableTransactionError(error) && attempt < 2) {
      await this.retryDelay(attempt);
      return null;
    }

    throw error;
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


  /** Reapplies a claimed pending reversal. The worker owns scheduling and expiry. */
  public async resolvePendingReference(
    id: string,
    context: WageringContext = {},
  ): Promise<"resolved" | "still_pending" | "ignored"> {
    return this.orm.em.transactional(async (entityManager) => {
      const transaction = await entityManager.findOne(
        WagerTransactionEntity,
        { id },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );

      if (!transaction || transaction.status !== "PENDING_REFERENCE") {
        return "ignored";
      }

      if (
        !transaction.walletId ||
        !transaction.playerId ||
        !transaction.currency ||
        !transaction.amount ||
        !transaction.roundId
      ) {
        return "ignored";
      }

      const walletEntity = await entityManager.findOne(
        WalletEntity,
        { id: transaction.walletId },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );

      if (!walletEntity) {
        return "ignored";
      }

      const wallet = Wallet.rehydrate({
        ...walletEntity,
        balance: Money.create(walletEntity.balance, walletEntity.currency),
      });

      await this.apply(
        entityManager,
        transaction,
        wallet,
        Money.create(transaction.amount, transaction.currency),
        {
          idempotencyKey: transaction.idempotencyKey,
          providerId: transaction.providerId,
          externalTransactionId: transaction.externalTransactionId,
          walletId: transaction.walletId,
          playerId: transaction.playerId,
          currency: transaction.currency,
          amount: transaction.amount,
          kind: transaction.kind as WagerKind,
          roundId: transaction.roundId,
          gameId: transaction.gameId,
          referenceExternalTransactionId:
            transaction.referenceExternalTransactionId,
        },
      );


      walletEntity.balance = wallet.balance.amount;
      walletEntity.version = wallet.version;
      walletEntity.updatedAt = wallet.updatedAt;

      transaction.observedBalance = wallet.balance.amount;
      transaction.updatedAt = new Date();
      transaction.referenceLeaseUntil = undefined;

      if (transaction.status === "PENDING_REFERENCE") {
        transaction.referenceLeaseUntil = undefined;
        await entityManager.flush();
        return "still_pending";
      }

      transaction.nextReferenceAttemptAt = undefined;
      this.stageEvents(entityManager, transaction, wallet, context);
      await entityManager.flush();

      return "resolved";
    });
  }

  public async expirePendingReference(
    id: string,
    context: WageringContext = {},
  ): Promise<boolean> {
    return this.orm.em.transactional(async (entityManager) => {
      const transaction = await entityManager.findOne(
        WagerTransactionEntity,
        { id },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );

      if (!transaction || transaction.status !== "PENDING_REFERENCE") {
        return false;
      }

      const wallet = transaction.walletId
        ? await entityManager.findOne(WalletEntity, {
            id: transaction.walletId,
          })
        : null;

      if (!wallet) {
        return false;
      }

      const domainWallet = Wallet.rehydrate({
        ...wallet,
        balance: Money.create(wallet.balance, wallet.currency),
      });

      this.reject(transaction, domainWallet, "REFERENCE_NOT_FOUND");
      transaction.referenceLeaseUntil = undefined;
      transaction.nextReferenceAttemptAt = undefined;
      transaction.updatedAt = new Date();

      this.stageEvents(entityManager, transaction, domainWallet, context);
      await entityManager.flush();

      return true;
    });
  }


  private async apply(
    entityManager: EntityManager,
    transaction: WagerTransactionEntity,
    wallet: Wallet,
    amount: Money,
    input: ProcessWagerInput,
  ): Promise<void> {
    if (input.kind === "LOSS") {
      transaction.status = "PROCESSED";
      return;
    }

    const hasReference = Boolean(input.referenceExternalTransactionId);
    const requiresReference =
      input.kind === "REFUND" || input.kind === "ROLLBACK";
    const allowsOptionalReference = input.kind === "WIN" && hasReference;

    let reference: WagerTransactionEntity | null = null;
    if (requiresReference || allowsOptionalReference) {
      reference = await this.resolveAndValidateReference(
        entityManager,
        transaction,
        wallet,
        amount,
        input,
      );

      if (!reference || transaction.status === "REJECTED") {
        return;
      }
    }

    try {
      const isDebit =
        input.kind === "BET" ||
        (input.kind === "ROLLBACK" && reference?.kind !== "BET");

      const entry = isDebit
        ? wallet.debit(amount, transaction.id, this.idGenerator.generate())
        : wallet.credit(amount, transaction.id, this.idGenerator.generate());

      const ledgerEntity = entityManager.create(WalletLedgerEntryEntity, {
        id: entry.id,
        walletId: entry.walletId,
        transactionId: entry.transactionId,
        direction: entry.direction,
        amount: entry.money.amount,
        currency: entry.money.currency,
        balanceBefore: entry.balanceBefore.amount,
        balanceAfter: entry.balanceAfter.amount,
        createdAt: entry.createdAt,
      });

      entityManager.persist(ledgerEntity);
      transaction.status = "PROCESSED";
    } catch (error) {
      if (error instanceof DomainError && error.code === "INSUFFICIENT_FUNDS") {
        return this.reject(
          transaction,
          wallet,
          input.kind === "BET"
            ? "INSUFFICIENT_FUNDS"
            : "REVERSAL_WOULD_NEGATIVE",
        );
      }
      throw error;
    }
  }

  private async resolveAndValidateReference(
    entityManager: EntityManager,
    transaction: WagerTransactionEntity,
    wallet: Wallet,
    amount: Money,
    input: ProcessWagerInput,
  ): Promise<WagerTransactionEntity | null> {
    const reference = await this.findReferenceTransaction(entityManager, input);

    if (!reference) {
      transaction.status = "PENDING_REFERENCE";
      return null;
    }

    transaction.referenceTransactionId = reference.id;

    const isValid = this.validateReferenceRules(
      transaction,
      wallet,
      reference,
      amount,
      input,
    );
    if (!isValid) {
      return null;
    }

    const isDuplicate = await this.isAlreadyReversed(
      entityManager,
      reference.id,
      input.kind,
      transaction.id,
    );
    if (isDuplicate) {
      this.reject(transaction, wallet, "REFERENCE_ALREADY_REVERSED");
      return null;
    }

    return reference;
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
    transaction: WagerTransactionEntity,
    wallet: Wallet,
    reference: WagerTransactionEntity,
    amount: Money,
    input: ProcessWagerInput,
  ): boolean {
    if (reference.status !== "PROCESSED") {
      this.reject(transaction, wallet, "REFERENCE_NOT_PROCESSED");
      return false;
    }

    if (!this.matchesScope(reference, input)) {
      this.reject(transaction, wallet, "REFERENCE_SCOPE_MISMATCH");
      return false;
    }

    if (this.isAmountMismatch(input.kind, reference.amount, amount.amount)) {
      this.reject(transaction, wallet, "REFERENCE_AMOUNT_MISMATCH");
      return false;
    }

    if (this.isInvalidReferenceKind(input.kind, reference.kind)) {
      this.reject(transaction, wallet, "INVALID_REFERENCE_KIND");
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
    reference: WagerTransactionEntity,
    input: ProcessWagerInput,
  ): boolean {
    const providerMatches =
      !reference.providerId || reference.providerId === input.providerId;
    const playerMatches = reference.playerId === input.playerId;
    const walletMatches = reference.walletId === input.walletId;
    const currencyMatches = reference.currency === input.currency;
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

  private reject(
    transaction: WagerTransactionEntity,
    wallet: Wallet,
    failureCode: string,
  ): void {
    transaction.status = "REJECTED";
    transaction.failureCode = failureCode;
    transaction.observedBalance = wallet.balance.amount;
  }

  private stageInbox(entityManager: EntityManager, inbox: InboxContext): void {
    const inboxEntity = entityManager.create(InboxMessageEntity, {
      id: this.idGenerator.generate(),
      consumerName: inbox.consumerName,
      messageId: inbox.messageId,
      payloadHash: inbox.payloadHash,
      processedAt: this.clock.now(),
    });
    entityManager.persist(inboxEntity);
  }

  private stageEvents(
    entityManager: EntityManager,
    transaction: WagerTransactionEntity,
    wallet: Wallet,
    context: WageringContext,
  ): void {
    const correlationId = context.correlationId ?? transaction.id;
    const eventData = {
      transactionId: transaction.id,
      status: transaction.status,
      failureCode: transaction.failureCode,
      balance: {
        amount: wallet.balance.amount,
        currency: wallet.currency,
      },
    };

    let event:
      | WagerTransactionRejected
      | WagerTransactionPendingReference
      | WagerTransactionProcessed;

    if (transaction.status === "REJECTED") {
      event = new WagerTransactionRejected(
        transaction.id,
        correlationId,
        eventData,
      );
    } else if (transaction.status === "PENDING_REFERENCE") {
      event = new WagerTransactionPendingReference(
        transaction.id,
        correlationId,
        eventData,
      );
    } else {
      event = new WagerTransactionProcessed(
        transaction.id,
        correlationId,
        eventData,
      );
    }

    event.envelope.causationId = context.causationId;

    const outboxMessage = entityManager.create(OutboxMessageEntity, {
      id: event.envelope.eventId,
      eventType: `${event.envelope.eventType}.v1`,
      payload: event.envelope,
      attemptCount: 0,
      nextAttemptAt: new Date(),
      createdAt: new Date(),
    });
    entityManager.persist(outboxMessage);

    if (transaction.status === "PROCESSED" && transaction.kind !== "LOSS") {
      const balanceEvent = new WalletBalanceChanged(wallet.id, correlationId, {
        walletId: wallet.id,
        balance: {
          amount: wallet.balance.amount,
          currency: wallet.currency,
        },
        transactionId: transaction.id,
      });

      balanceEvent.envelope.causationId = context.causationId;

      const balanceOutboxMessage = entityManager.create(OutboxMessageEntity, {
        id: balanceEvent.envelope.eventId,
        eventType: "WalletBalanceChanged.v1",
        payload: balanceEvent.envelope,
        attemptCount: 0,
        nextAttemptAt: new Date(),
        createdAt: new Date(),
      });
      entityManager.persist(balanceOutboxMessage);
    }
  }

  private output(
    transaction: WagerTransactionEntity,
    idempotentReplay: boolean,
  ): ProcessWagerOutput {
    return {
      id: transaction.id,
      transactionId: transaction.id,
      status: transaction.status,
      failureCode: transaction.failureCode,
      gameId: transaction.gameId,
      balance: {
        amount: transaction.observedBalance ?? "0.00",
        currency: transaction.currency ?? "XXX",
      },
      idempotentReplay,
    };
  }


  private recordOutput(
    transaction: WagerTransactionEntity,
    isReplay: boolean,
    startedAt: number,
  ): ProcessWagerOutput {
    this.metrics.increment("wager_transactions_total", {
      kind: transaction.kind,
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
