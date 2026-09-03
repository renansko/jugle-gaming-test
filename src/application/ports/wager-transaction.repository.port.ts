import type { WagerTransaction } from "../../domain/wagering/wager-transaction";

export interface WagerTransactionRepositoryPort {
  findById(id: string, lock?: boolean): Promise<WagerTransaction | null>;
  findByIdempotencyKey(key: string): Promise<WagerTransaction | null>;
  findByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null>;
  save(transaction: WagerTransaction): Promise<void>;
  create(transaction: WagerTransaction): Promise<void>;
}

export const WAGER_TRANSACTION_REPOSITORY_PORT = Symbol(
  "WAGER_TRANSACTION_REPOSITORY_PORT",
);
