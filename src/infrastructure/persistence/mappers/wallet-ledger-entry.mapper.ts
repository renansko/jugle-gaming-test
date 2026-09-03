import { Money } from "../../../domain/shared/money";
import {
  type LedgerDirection,
  WalletLedgerEntry,
} from "../../../domain/wallet/wallet-ledger-entry";
import type { WalletLedgerEntryEntity } from "../entities/wallet-ledger-entry.entity";

export function walletLedgerEntryToDomain(
  entity: WalletLedgerEntryEntity,
): WalletLedgerEntry {
  return WalletLedgerEntry.create({
    id: entity.id,
    walletId: entity.walletId,
    transactionId: entity.transactionId,
    direction: entity.direction as LedgerDirection,
    money: Money.create(entity.amount, entity.currency),
    balanceBefore: Money.create(entity.balanceBefore, entity.currency),
    balanceAfter: Money.create(entity.balanceAfter, entity.currency),
    createdAt: entity.createdAt,
  });
}

export function walletLedgerEntryToPersistence(
  domain: WalletLedgerEntry,
  target?: WalletLedgerEntryEntity,
): WalletLedgerEntryEntity {
  const entity = (target ?? {}) as WalletLedgerEntryEntity;

  entity.id = domain.id;
  entity.walletId = domain.walletId;
  entity.transactionId = domain.transactionId;
  entity.direction = domain.direction;
  entity.amount = domain.money.amount;
  entity.currency = domain.money.currency;
  entity.balanceBefore = domain.balanceBefore.amount;
  entity.balanceAfter = domain.balanceAfter.amount;
  entity.createdAt = domain.createdAt;

  return entity;
}
