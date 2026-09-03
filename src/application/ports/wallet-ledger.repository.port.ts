import type { WalletLedgerEntry } from "../../domain/wallet/wallet-ledger-entry";

export interface WalletLedgerRepositoryPort {
  append(entry: WalletLedgerEntry): Promise<void>;
}

export const WALLET_LEDGER_REPOSITORY_PORT = Symbol(
  "WALLET_LEDGER_REPOSITORY_PORT",
);
