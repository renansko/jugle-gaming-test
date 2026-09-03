import type { Wallet } from "../../domain/wallet/wallet";

export interface WalletRepositoryPort {
  findById(id: string, lock?: boolean): Promise<Wallet | null>;
  save(wallet: Wallet): Promise<void>;
  create(wallet: Wallet): Promise<void>;
}

export const WALLET_REPOSITORY_PORT = Symbol("WALLET_REPOSITORY_PORT");
