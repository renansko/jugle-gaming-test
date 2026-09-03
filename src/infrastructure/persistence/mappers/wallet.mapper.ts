import { Money } from "../../../domain/shared/money";
import { Wallet } from "../../../domain/wallet/wallet";
import type { WalletEntity } from "../entities/wallet.entity";

export function walletToDomain(entity: WalletEntity): Wallet {
  return Wallet.rehydrate({
    id: entity.id,
    playerId: entity.playerId,
    currency: entity.currency,
    balance: Money.create(entity.balance, entity.currency),
    version: entity.version,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  });
}

export function walletToPersistence(domain: Wallet, target?: WalletEntity): WalletEntity {
  const entity = target ?? {
    id: domain.id,
    playerId: domain.playerId,
    currency: domain.currency,
    balance: domain.balance.amount,
    version: domain.version,
    createdAt: domain.createdAt,
    updatedAt: domain.updatedAt,
  } as WalletEntity;

  entity.id = domain.id;
  entity.playerId = domain.playerId;
  entity.currency = domain.currency;
  entity.balance = domain.balance.amount;
  entity.version = domain.version;
  entity.createdAt = domain.createdAt;
  entity.updatedAt = domain.updatedAt;

  return entity;
}

