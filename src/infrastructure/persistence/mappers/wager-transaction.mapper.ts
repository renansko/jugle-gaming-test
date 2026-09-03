import { Money } from "../../../domain/shared/money";
import {
  WagerTransaction,
  type WagerTransactionKind,
  type WagerTransactionStatus,
} from "../../../domain/wagering/wager-transaction";
import type { WagerTransactionEntity } from "../entities/wager-transaction.entity";

export function wagerTransactionToDomain(
  entity: WagerTransactionEntity,
): WagerTransaction {
  const currency = entity.currency;
  const money =
    entity.amount && currency
      ? Money.create(entity.amount, currency)
      : undefined;
  const observedBalance =
    entity.observedBalance && currency
      ? Money.create(entity.observedBalance, currency)
      : undefined;

  return WagerTransaction.rehydrate({
    id: entity.id,
    idempotencyKey: entity.idempotencyKey,
    providerId: entity.providerId,
    externalTransactionId: entity.externalTransactionId,
    payloadHash: entity.payloadHash,
    kind: entity.kind as WagerTransactionKind,
    walletId: entity.walletId,
    playerId: entity.playerId,
    money,
    roundId: entity.roundId,
    gameId: entity.gameId,
    referenceExternalTransactionId: entity.referenceExternalTransactionId,
    referenceTransactionId: entity.referenceTransactionId,
    status: entity.status as WagerTransactionStatus,
    failureCode: entity.failureCode,
    observedBalance,
    referenceAttemptCount: entity.referenceAttemptCount ?? 0,
    nextReferenceAttemptAt: entity.nextReferenceAttemptAt,
    referenceLeaseUntil: entity.referenceLeaseUntil,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  });
}

function assignIdentityProps(
  entity: WagerTransactionEntity,
  domain: WagerTransaction,
): void {
  if (domain.id) entity.id = domain.id;
  if (domain.idempotencyKey) entity.idempotencyKey = domain.idempotencyKey;
  if (domain.providerId) entity.providerId = domain.providerId;
  if (domain.externalTransactionId) {
    entity.externalTransactionId = domain.externalTransactionId;
  }
  if (domain.payloadHash) entity.payloadHash = domain.payloadHash;
}

function assignFinancialProps(
  entity: WagerTransactionEntity,
  domain: WagerTransaction,
): void {
  if (domain.kind) entity.kind = domain.kind;
  entity.walletId = domain.walletId;
  entity.playerId = domain.playerId;
  entity.currency = domain.money ? domain.money.currency : undefined;
  entity.amount = domain.money ? domain.money.amount : undefined;
  entity.roundId = domain.roundId;
  entity.gameId = domain.gameId;
  entity.status = domain.status;
  entity.failureCode = domain.failureCode;
  entity.observedBalance = domain.observedBalance
    ? domain.observedBalance.amount
    : undefined;
}

function assignReferenceProps(
  entity: WagerTransactionEntity,
  domain: WagerTransaction,
): void {
  entity.referenceExternalTransactionId =
    domain.referenceExternalTransactionId;
  entity.referenceTransactionId = domain.referenceTransactionId;
  entity.referenceAttemptCount = domain.referenceAttemptCount || 0;
  entity.nextReferenceAttemptAt = domain.nextReferenceAttemptAt;
  entity.referenceLeaseUntil = domain.referenceLeaseUntil;
  if (domain.createdAt) entity.createdAt = domain.createdAt;
  if (domain.updatedAt) entity.updatedAt = domain.updatedAt;
}

export function wagerTransactionToPersistence(
  domain: WagerTransaction,
  target?: WagerTransactionEntity,
): WagerTransactionEntity {
  const entity = target || ({} as WagerTransactionEntity);
  assignIdentityProps(entity, domain);
  assignFinancialProps(entity, domain);
  assignReferenceProps(entity, domain);
  return entity;
}
