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
import { WalletBalanceChanged, WagerTransactionPendingReference, WagerTransactionProcessed, WagerTransactionRejected } from "../../domain/messaging/integration-event";
import { canonicalPayloadHash } from "./canonical-payload";
import { OperationalMetrics } from "../../infrastructure/observability/operational-metrics";

export type WagerKind = "BET" | "WIN" | "LOSS" | "REFUND" | "ROLLBACK";
export type ProcessWagerInput = {
  idempotencyKey: string; providerId: string; externalTransactionId: string; walletId: string; playerId: string;
  currency: string; amount: string; kind: WagerKind; roundId: string; referenceExternalTransactionId?: string;
};
export type ProcessWagerOutput = { id: string; status: string; failureCode?: string; balance: { amount: string; currency: string }; idempotentReplay: boolean };
export type InboxContext = { consumerName: string; messageId: string; payloadHash: string };
export type WageringContext = { correlationId?: string; causationId?: string; inbox?: InboxContext };

/** @wiki docs/brain/services/WageringService.md */
@Injectable()
export class WageringService {
  public constructor(@Inject(MikroORM) private readonly orm: MikroORM, @Inject(OperationalMetrics) private readonly metrics: OperationalMetrics) {}

  public async execute(input: ProcessWagerInput, context: WageringContext = {}): Promise<ProcessWagerOutput> {
    const startedAt = Date.now();
    const amount = Money.create(input.amount, input.currency);
    const hash = canonicalPayloadHash({ amount: amount.amount, currency: input.currency, externalTransactionId: input.externalTransactionId, kind: input.kind, playerId: input.playerId, providerId: input.providerId, referenceExternalTransactionId: input.referenceExternalTransactionId ?? null, roundId: input.roundId, walletId: input.walletId });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.orm.em.transactional(async (em) => {
          const existingInbox = context.inbox
            ? await em.findOne(InboxMessageEntity, { consumerName: context.inbox.consumerName, messageId: context.inbox.messageId })
            : null;
          if (existingInbox && existingInbox.payloadHash !== context.inbox?.payloadHash) {
            throw new DomainError("MESSAGE_PERMANENT_FAILURE", "Message id was reused with a different payload");
          }
          const existing = await em.findOne(WagerTransactionEntity, { idempotencyKey: input.idempotencyKey });
          if (existing) {
            if (existing.payloadHash !== hash) throw new DomainError("IDEMPOTENCY_CONFLICT", "Idempotency key was already used for another payload");
            if (context.inbox && !existingInbox) this.stageInbox(em, context.inbox);
            await em.flush();
            return this.recordOutput(existing, true, startedAt);
          }
          const existingProviderTransaction = await em.findOne(WagerTransactionEntity, { providerId: input.providerId, externalTransactionId: input.externalTransactionId });
          if (existingProviderTransaction) {
            if (existingProviderTransaction.payloadHash !== hash) throw new DomainError("IDEMPOTENCY_CONFLICT", "Provider transaction identity was already used for another payload");
            if (context.inbox && !existingInbox) this.stageInbox(em, context.inbox);
            await em.flush();
            return this.recordOutput(existingProviderTransaction, true, startedAt);
          }
          if (existingInbox) throw new DomainError("DEPENDENCY_UNAVAILABLE", "Inbox exists without its financial transaction");

          const lockStartedAt = Date.now();
          const walletEntity = await em.findOne(WalletEntity, { id: input.walletId }, { lockMode: LockMode.PESSIMISTIC_WRITE });
          this.metrics.observe("wallet_lock_duration_ms", Date.now() - lockStartedAt);
          if (!walletEntity) throw new DomainError("WALLET_NOT_FOUND", "Wallet not found");
          const wallet = Wallet.rehydrate({ ...walletEntity, balance: Money.create(walletEntity.balance, walletEntity.currency) });
          const transaction = em.create(WagerTransactionEntity, {
            id: randomUUID(), idempotencyKey: input.idempotencyKey, providerId: input.providerId, externalTransactionId: input.externalTransactionId,
            payloadHash: hash, walletId: input.walletId, playerId: input.playerId, currency: input.currency, amount: amount.amount, kind: input.kind,
            roundId: input.roundId, referenceExternalTransactionId: input.referenceExternalTransactionId, status: "PENDING", createdAt: new Date(), updatedAt: new Date(),
          });
          if (wallet.playerId !== input.playerId) this.reject(transaction, wallet, "REFERENCE_SCOPE_MISMATCH");
          else if (wallet.currency !== input.currency) this.reject(transaction, wallet, "CURRENCY_MISMATCH");
          else await this.apply(em, transaction, wallet, amount, input);
          if (transaction.status === "PENDING_REFERENCE") transaction.nextReferenceAttemptAt = new Date();
          walletEntity.balance = wallet.balance.amount;
          walletEntity.version = wallet.version;
          walletEntity.updatedAt = wallet.updatedAt;
          transaction.observedBalance = wallet.balance.amount;
          this.stageEvents(em, transaction, wallet, context);
          if (context.inbox) this.stageInbox(em, context.inbox);
          await em.persistAndFlush([transaction, walletEntity]);
          return this.recordOutput(transaction, false, startedAt);
        });
      } catch (error) {
        if (this.isReferenceUniqueViolation(error)) throw new DomainError("REFERENCE_ALREADY_REVERSED", "Reference was already reversed by this operation type");
        if (this.isUniqueViolation(error)) {
          const saved = await this.findPersistedTransaction(input);
          if (saved) {
            if (saved.payloadHash !== hash) throw new DomainError("IDEMPOTENCY_CONFLICT", "Idempotency key was already used for another payload");
            return this.recordOutput(saved, true, startedAt);
          }
          continue;
        }
        if (this.isRetryableTransactionError(error) && attempt < 2) {
          await this.retryDelay(attempt);
          continue;
        }
        throw error;
      }
    }
    throw new DomainError("DEPENDENCY_UNAVAILABLE", "Transaction contention exceeded retry limit");
  }

  public async get(id: string): Promise<ProcessWagerOutput | null> { const transaction = await this.orm.em.fork().findOne(WagerTransactionEntity, { id }); return transaction ? this.output(transaction, false) : null; }
  public async getByProvider(providerId: string, externalTransactionId: string): Promise<ProcessWagerOutput | null> { const transaction = await this.orm.em.fork().findOne(WagerTransactionEntity, { providerId, externalTransactionId }); return transaction ? this.output(transaction, false) : null; }

  /** Reapplies a claimed pending reversal. The worker owns scheduling and expiry. */
  public async resolvePendingReference(id: string, context: WageringContext = {}): Promise<"resolved" | "still_pending" | "ignored"> {
    return this.orm.em.transactional(async (em) => {
      const transaction = await em.findOne(WagerTransactionEntity, { id }, { lockMode: LockMode.PESSIMISTIC_WRITE });
      if (!transaction || transaction.status !== "PENDING_REFERENCE") return "ignored";
      if (!transaction.walletId || !transaction.playerId || !transaction.currency || !transaction.amount || !transaction.roundId) return "ignored";
      const walletEntity = await em.findOne(WalletEntity, { id: transaction.walletId }, { lockMode: LockMode.PESSIMISTIC_WRITE });
      if (!walletEntity) return "ignored";
      const wallet = Wallet.rehydrate({ ...walletEntity, balance: Money.create(walletEntity.balance, walletEntity.currency) });
      await this.apply(em, transaction, wallet, Money.create(transaction.amount, transaction.currency), {
        idempotencyKey: transaction.idempotencyKey, providerId: transaction.providerId, externalTransactionId: transaction.externalTransactionId,
        walletId: transaction.walletId, playerId: transaction.playerId, currency: transaction.currency, amount: transaction.amount,
        kind: transaction.kind as WagerKind, roundId: transaction.roundId, referenceExternalTransactionId: transaction.referenceExternalTransactionId,
      });
      walletEntity.balance = wallet.balance.amount;
      walletEntity.version = wallet.version;
      walletEntity.updatedAt = wallet.updatedAt;
      transaction.observedBalance = wallet.balance.amount;
      transaction.updatedAt = new Date();
      transaction.referenceLeaseUntil = undefined;
      if (transaction.status === "PENDING_REFERENCE") {
        transaction.referenceLeaseUntil = undefined;
        await em.flush();
        return "still_pending";
      }
      transaction.nextReferenceAttemptAt = undefined;
      this.stageEvents(em, transaction, wallet, context);
      await em.persistAndFlush([transaction, walletEntity]);
      return "resolved";
    });
  }

  public async expirePendingReference(id: string, context: WageringContext = {}): Promise<boolean> {
    return this.orm.em.transactional(async (em) => {
      const transaction = await em.findOne(WagerTransactionEntity, { id }, { lockMode: LockMode.PESSIMISTIC_WRITE });
      if (!transaction || transaction.status !== "PENDING_REFERENCE") return false;
      const wallet = transaction.walletId ? await em.findOne(WalletEntity, { id: transaction.walletId }) : null;
      if (!wallet) return false;
      const domainWallet = Wallet.rehydrate({ ...wallet, balance: Money.create(wallet.balance, wallet.currency) });
      this.reject(transaction, domainWallet, "REFERENCE_NOT_FOUND");
      transaction.referenceLeaseUntil = undefined;
      transaction.nextReferenceAttemptAt = undefined;
      transaction.updatedAt = new Date();
      this.stageEvents(em, transaction, domainWallet, context);
      await em.persistAndFlush(transaction);
      return true;
    });
  }

  private async apply(em: EntityManager, transaction: WagerTransactionEntity, wallet: Wallet, amount: Money, input: ProcessWagerInput): Promise<void> {
    if (input.kind === "LOSS") { transaction.status = "PROCESSED"; return; }
    let reference: WagerTransactionEntity | null = null;
    if (input.kind === "REFUND" || input.kind === "ROLLBACK") {
      reference = await em.findOne(WagerTransactionEntity, { providerId: input.providerId, externalTransactionId: input.referenceExternalTransactionId ?? "" });
      if (!reference) { transaction.status = "PENDING_REFERENCE"; return; }
      transaction.referenceTransactionId = reference.id;
      if (reference.status !== "PROCESSED") return this.reject(transaction, wallet, "REFERENCE_NOT_PROCESSED");
      const scopeMatches = reference.playerId === input.playerId && reference.walletId === input.walletId && reference.currency === input.currency && reference.roundId === input.roundId;
      if (!scopeMatches) return this.reject(transaction, wallet, "REFERENCE_SCOPE_MISMATCH");
      if (reference.amount !== amount.amount) return this.reject(transaction, wallet, "REFERENCE_AMOUNT_MISMATCH");
      if (input.kind === "REFUND" && reference.kind !== "BET") return this.reject(transaction, wallet, "INVALID_REFERENCE_KIND");
      if (input.kind === "ROLLBACK" && !["BET", "WIN", "REFUND"].includes(reference.kind)) return this.reject(transaction, wallet, "INVALID_REFERENCE_KIND");
    }
    try {
      const entry = input.kind === "BET" || (input.kind === "ROLLBACK" && reference?.kind !== "BET")
        ? wallet.debit(amount, transaction.id, randomUUID())
        : wallet.credit(amount, transaction.id, randomUUID());
      em.persist(em.create(WalletLedgerEntryEntity, { id: entry.id, walletId: entry.walletId, transactionId: entry.transactionId, direction: entry.direction, amount: entry.money.amount, currency: entry.money.currency, balanceBefore: entry.balanceBefore.amount, balanceAfter: entry.balanceAfter.amount, createdAt: entry.createdAt }));
      transaction.status = "PROCESSED";
    } catch (error) {
      if (error instanceof DomainError && error.code === "INSUFFICIENT_FUNDS") return this.reject(transaction, wallet, input.kind === "BET" ? "INSUFFICIENT_FUNDS" : "REVERSAL_WOULD_NEGATIVE");
      throw error;
    }
  }

  private reject(transaction: WagerTransactionEntity, wallet: Wallet, code: string): void { transaction.status = "REJECTED"; transaction.failureCode = code; transaction.observedBalance = wallet.balance.amount; }
  private stageInbox(em: EntityManager, inbox: InboxContext): void {
    em.persist(em.create(InboxMessageEntity, {
      id: randomUUID(), consumerName: inbox.consumerName, messageId: inbox.messageId,
      payloadHash: inbox.payloadHash, processedAt: new Date(),
    }));
  }
  private stageEvents(em: EntityManager, transaction: WagerTransactionEntity, wallet: Wallet, context: WageringContext): void {
    const correlationId = context.correlationId ?? transaction.id;
    const data = { transactionId: transaction.id, status: transaction.status, failureCode: transaction.failureCode, balance: { amount: wallet.balance.amount, currency: wallet.currency } };
    const event = transaction.status === "REJECTED" ? new WagerTransactionRejected(transaction.id, correlationId, data) : transaction.status === "PENDING_REFERENCE" ? new WagerTransactionPendingReference(transaction.id, correlationId, data) : new WagerTransactionProcessed(transaction.id, correlationId, data);
    event.envelope.causationId = context.causationId;
    em.persist(em.create(OutboxMessageEntity, { id: event.envelope.eventId, eventType: `${event.envelope.eventType}.v1`, payload: event.envelope, attemptCount: 0, nextAttemptAt: new Date(), createdAt: new Date() }));
    if (transaction.status === "PROCESSED" && transaction.kind !== "LOSS") {
      const balanceEvent = new WalletBalanceChanged(wallet.id, correlationId, { walletId: wallet.id, balance: { amount: wallet.balance.amount, currency: wallet.currency }, transactionId: transaction.id });
      balanceEvent.envelope.causationId = context.causationId;
      em.persist(em.create(OutboxMessageEntity, { id: balanceEvent.envelope.eventId, eventType: "WalletBalanceChanged.v1", payload: balanceEvent.envelope, attemptCount: 0, nextAttemptAt: new Date(), createdAt: new Date() }));
    }
  }
  private output(transaction: WagerTransactionEntity, idempotentReplay: boolean): ProcessWagerOutput { return { id: transaction.id, status: transaction.status, failureCode: transaction.failureCode, balance: { amount: transaction.observedBalance ?? "0.00", currency: transaction.currency ?? "XXX" }, idempotentReplay }; }
  private recordOutput(transaction: WagerTransactionEntity, replay: boolean, startedAt: number): ProcessWagerOutput {
    this.metrics.increment("wager_transactions_total", { kind: transaction.kind, status: transaction.status, failureCode: transaction.failureCode ?? "none" });
    if (replay) this.metrics.increment("idempotency_replays_total");
    this.metrics.observe("wager_processing_latency_ms", Date.now() - startedAt, { channel: "application" });
    return this.output(transaction, replay);
  }
  private async findPersistedTransaction(input: ProcessWagerInput): Promise<WagerTransactionEntity | null> {
    const em = this.orm.em.fork();
    return (await em.findOne(WagerTransactionEntity, { idempotencyKey: input.idempotencyKey }))
      ?? em.findOne(WagerTransactionEntity, { providerId: input.providerId, externalTransactionId: input.externalTransactionId });
  }
  private async retryDelay(attempt: number): Promise<void> {
    const baseDelayMs = 20 * 2 ** attempt;
    const jitterMs = Math.floor(Math.random() * 20);
    await new Promise<void>((resolve) => setTimeout(resolve, baseDelayMs + jitterMs));
  }
  private isUniqueViolation(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && error.code === "23505"; }
  private isRetryableTransactionError(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && (error.code === "40001" || error.code === "40P01"); }
  private isReferenceUniqueViolation(error: unknown): boolean { return typeof error === "object" && error !== null && "constraint" in error && error.constraint === "wager_transactions_reference_kind_unique"; }
}
