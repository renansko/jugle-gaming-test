import { Inject, Injectable } from "@nestjs/common";
import { LockMode } from "@mikro-orm/core";
import { type EntityManager, MikroORM } from "@mikro-orm/postgresql";
import { randomUUID } from "node:crypto";
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

/** @wiki docs/brain/services/WageringService.md */
@Injectable()
export class WageringService {
  public constructor(
    @Inject(MikroORM)
    private readonly orm: MikroORM,
    @Inject(OperationalMetrics)
    private readonly metrics: OperationalMetrics,
  ) {}

  public async execute(
    input: ProcessWagerInput,
    context: WageringContext = {},
  ): Promise<ProcessWagerOutput> {
    const startedAt = Date.now();
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

          const walletEntity = await this.lockWallet(
            entityManager,
            input.walletId,
          );
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

          await this.processWagerMovement(
            entityManager,
            transaction,
            wallet,
            amount,
            input,
          );

          if (transaction.status === "PENDING_REFERENCE") {
            transaction.nextReferenceAttemptAt = new Date();
          }

          walletEntity.balance = wallet.balance.amount;
          walletEntity.version = wallet.version;
          walletEntity.updatedAt = wallet.updatedAt;
          transaction.observedBalance = wallet.balance.amount;

          this.stageEvents(entityManager, transaction, wallet, context);
          if (context.inbox) {
            this.stageInbox(entityManager, context.inbox);
          }

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
    const lockStartedAt = Date.now();
    const walletEntity = await entityManager.findOne(
      WalletEntity,
      { id: walletId },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    this.metrics.observe("wallet_lock_duration_ms", Date.now() - lockStartedAt);

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
    return entityManager.create(WagerTransactionEntity, {
      id: randomUUID(),
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

      createdAt: new Date(),
      updatedAt: new Date(),
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

    let reference: WagerTransactionEntity | null = null;
    if (input.kind === "REFUND" || input.kind === "ROLLBACK") {
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
        ? wallet.debit(amount, transaction.id, randomUUID())
        : wallet.credit(amount, transaction.id, randomUUID());

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
    const reference = await entityManager.findOne(WagerTransactionEntity, {
      providerId: input.providerId,
      externalTransactionId: input.referenceExternalTransactionId ?? "",
    });

    if (!reference) {
      transaction.status = "PENDING_REFERENCE";
      return null;
    }

    transaction.referenceTransactionId = reference.id;

    if (reference.status !== "PROCESSED") {
      this.reject(transaction, wallet, "REFERENCE_NOT_PROCESSED");
      return null;
    }

    const scopeMatches =
      reference.playerId === input.playerId &&
      reference.walletId === input.walletId &&
      reference.currency === input.currency &&
      reference.roundId === input.roundId;

    if (!scopeMatches) {
      this.reject(transaction, wallet, "REFERENCE_SCOPE_MISMATCH");
      return null;
    }

    if (reference.amount !== amount.amount) {
      this.reject(transaction, wallet, "REFERENCE_AMOUNT_MISMATCH");
      return null;
    }

    if (input.kind === "REFUND" && reference.kind !== "BET") {
      this.reject(transaction, wallet, "INVALID_REFERENCE_KIND");
      return null;
    }

    if (
      input.kind === "ROLLBACK" &&
      !["BET", "WIN", "REFUND"].includes(reference.kind)
    ) {
      this.reject(transaction, wallet, "INVALID_REFERENCE_KIND");
      return null;
    }

    return reference;
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
      id: randomUUID(),
      consumerName: inbox.consumerName,
      messageId: inbox.messageId,
      payloadHash: inbox.payloadHash,
      processedAt: new Date(),
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
      Date.now() - startedAt,
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
    const baseDelayMs = 20 * 2 ** attempt;
    const jitterMs = Math.floor(Math.random() * 20);
    await new Promise<void>((resolve) =>
      setTimeout(resolve, baseDelayMs + jitterMs),
    );
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
