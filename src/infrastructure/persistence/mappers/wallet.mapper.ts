import { Money } from "../../../domain/shared/money";
import { Wallet } from "../../../domain/wallet/wallet";
import type { WalletEntity } from "../entities/wallet.entity";

export function walletToDomain(entity: WalletEntity): Wallet {
  return Wallet.rehydrate({ id: entity.id, playerId: entity.playerId, currency: entity.currency, balance: Money.create(entity.balance, entity.currency), version: entity.version, createdAt: entity.createdAt, updatedAt: entity.updatedAt });
}
