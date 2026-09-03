import { describe, expect, mock, test } from "bun:test";
import type { EntityManager, MikroORM } from "@mikro-orm/postgresql";
import { WageringService } from "../../../src/application/wagering/wagering.service";
import { canonicalPayloadHash } from "../../../src/application/wagering/canonical-payload";
import { DomainError } from "../../../src/domain/shared/domain-error";
import type { OperationalMetrics } from "../../../src/infrastructure/observability/operational-metrics";
import { WalletEntity } from "../../../src/infrastructure/persistence/entities/wallet.entity";

import { WagerTransactionEntity } from "../../../src/infrastructure/persistence/entities/wager-transaction.entity";
import { WalletLedgerEntryEntity } from "../../../src/infrastructure/persistence/entities/wallet-ledger-entry.entity";
import { OutboxMessageEntity } from "../../../src/infrastructure/persistence/entities/outbox-message.entity";

type MockTransaction = {
  id: string;
  idempotencyKey?: string;
  payloadHash?: string;
  observedBalance?: string;
  currency?: string;
  status: string;
  kind?: string;
  amount?: string;
  roundId?: string;
  walletId?: string;
  playerId?: string;
  externalTransactionId?: string;
};

type MockWallet = {
  id: string;
  playerId: string;
  currency: string;
  balance: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

describe("WageringService Application Service", () => {
  const dummyMetrics = {
    increment: mock(() => {}),
    observe: mock(() => {}),
  } as unknown as OperationalMetrics;

  const createEmMock = (setup: {
    existingTransaction?: MockTransaction;
    existingProviderTx?: MockTransaction;
    wallet?: MockWallet;
    referenceTx?: MockTransaction;
  }) => {
    const created: Array<{ entityClass: unknown; data: unknown }> = [];
    const persisted: unknown[] = [];

    const em = {
      findOne: mock(
        async (entityClass: unknown, filter: Record<string, unknown>) => {
          if (entityClass === WagerTransactionEntity) {
            if (filter.idempotencyKey) {
              return setup.existingTransaction ?? null;
            }
            if (filter.providerId && filter.externalTransactionId) {
              if (
                setup.existingProviderTx &&
                filter.externalTransactionId ===
                  setup.existingProviderTx.externalTransactionId
              ) {
                return setup.existingProviderTx;
              }
              if (
                setup.referenceTx &&
                filter.externalTransactionId ===
                  setup.referenceTx.externalTransactionId
              ) {
                return setup.referenceTx;
              }
              return null;
            }
            if (filter.id) {
              if (
                setup.existingTransaction &&
                filter.id === setup.existingTransaction.id
              )
                return setup.existingTransaction;
              if (setup.referenceTx && filter.id === setup.referenceTx.id)
                return setup.referenceTx;
              return null;
            }
            return null;
          }
          if (entityClass === WalletEntity) {
            return setup.wallet ?? null;
          }
          return null;
        },
      ),
      create: mock((entityClass: unknown, data: unknown) => {
        created.push({ entityClass, data });
        return data;
      }),
      persist: mock((entity: unknown) => {
        persisted.push(entity);
      }),
      persistAndFlush: mock(async (entities: unknown) => {
        persisted.push(entities);
      }),
      flush: mock(async () => {}),
    } as unknown as EntityManager;

    const orm = {
      em: {
        transactional: mock(
          async (cb: (em: EntityManager) => Promise<unknown>) => cb(em),
        ),
        fork: mock(() => em),
      },
    } as unknown as MikroORM;

    return { em, orm, created, persisted };
  };

  describe("Idempotency Controls", () => {
    test("returns recorded output with idempotentReplay: true when key exists with identical payload", async () => {
      const input = {
        idempotencyKey: "key-1",
        providerId: "prov-1",
        externalTransactionId: "ext-1",
        walletId: "w-1",
        playerId: "p-1",
        currency: "USD",
        amount: "30.00",
        kind: "BET" as const,
        roundId: "r-1",
      };
      const exactHash = canonicalPayloadHash({
        amount: "30.00",
        currency: "USD",
        externalTransactionId: "ext-1",
        gameId: null,
        kind: "BET",
        playerId: "p-1",
        providerId: "prov-1",
        referenceExternalTransactionId: null,
        roundId: "r-1",
        walletId: "w-1",
      });


      const existing: MockTransaction = {
        id: "tx-existing",
        idempotencyKey: "key-1",
        payloadHash: exactHash,
        observedBalance: "70.00",
        currency: "USD",
        status: "PROCESSED",
        kind: "BET",
      };

      const { orm } = createEmMock({ existingTransaction: existing });
      const service = new WageringService(orm, dummyMetrics);

      const result = await service.execute(input);

      expect(result.id).toBe("tx-existing");
      expect(result.idempotentReplay).toBe(true);
      expect(result.status).toBe("PROCESSED");
      expect(result.balance.amount).toBe("70.00");
    });

    test("throws IDEMPOTENCY_CONFLICT when key exists but payload hash is different", async () => {
      const existing: MockTransaction = {
        id: "tx-existing",
        idempotencyKey: "key-1",
        payloadHash: "different_hash_value",
        status: "PROCESSED",
      };

      const { orm } = createEmMock({ existingTransaction: existing });
      const service = new WageringService(orm, dummyMetrics);

      await expect(
        service.execute({
          idempotencyKey: "key-1",
          providerId: "prov-1",
          externalTransactionId: "ext-1",
          walletId: "w-1",
          playerId: "p-1",
          currency: "USD",
          amount: "30.00",
          kind: "BET",
          roundId: "r-1",
        }),
      ).rejects.toThrow(DomainError);
    });
  });

  describe("BET Execution", () => {
    test("processes BET successfully when wallet has sufficient funds", async () => {
      const wallet: MockWallet = {
        id: "w-1",
        playerId: "p-1",
        currency: "USD",
        balance: "100.00",
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const { orm, created } = createEmMock({ wallet });
      const service = new WageringService(orm, dummyMetrics);

      const result = await service.execute({
        idempotencyKey: "key-new",
        providerId: "prov-1",
        externalTransactionId: "ext-new",
        walletId: "w-1",
        playerId: "p-1",
        currency: "USD",
        amount: "40.00",
        kind: "BET",
        roundId: "r-1",
      });

      expect(result.status).toBe("PROCESSED");
      expect(result.idempotentReplay).toBe(false);
      expect(result.transactionId).toBeDefined();
      expect(result.transactionId).toBe(result.id);
      expect(result.balance.amount).toBe("60.00");
      expect(wallet.balance).toBe("60.00");
      expect(wallet.version).toBe(2);

      expect(
        created.some((c) => c.entityClass === WalletLedgerEntryEntity),
      ).toBe(true);
      expect(created.some((c) => c.entityClass === OutboxMessageEntity)).toBe(
        true,
      );
    });

    test("rejects BET with INSUFFICIENT_FUNDS without mutating balance or creating ledger entry", async () => {
      const wallet: MockWallet = {
        id: "w-1",
        playerId: "p-1",
        currency: "USD",
        balance: "20.00",
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const { orm, created } = createEmMock({ wallet });
      const service = new WageringService(orm, dummyMetrics);

      const result = await service.execute({
        idempotencyKey: "key-broke",
        providerId: "prov-1",
        externalTransactionId: "ext-broke",
        walletId: "w-1",
        playerId: "p-1",
        currency: "USD",
        amount: "50.00",
        kind: "BET",
        roundId: "r-1",
      });

      expect(result.status).toBe("REJECTED");
      expect(result.failureCode).toBe("INSUFFICIENT_FUNDS");
      expect(result.balance.amount).toBe("20.00");
      expect(wallet.balance).toBe("20.00");
      expect(wallet.version).toBe(1);

      expect(
        created.some((c) => c.entityClass === WalletLedgerEntryEntity),
      ).toBe(false);
      expect(created.some((c) => c.entityClass === OutboxMessageEntity)).toBe(
        true,
      );
    });
  });

  describe("WIN and LOSS Execution", () => {
    test("processes WIN by crediting wallet balance and creating ledger", async () => {
      const wallet: MockWallet = {
        id: "w-1",
        playerId: "p-1",
        currency: "USD",
        balance: "50.00",
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const { orm, created } = createEmMock({ wallet });
      const service = new WageringService(orm, dummyMetrics);

      const result = await service.execute({
        idempotencyKey: "key-win",
        providerId: "prov-1",
        externalTransactionId: "ext-win",
        walletId: "w-1",
        playerId: "p-1",
        currency: "USD",
        amount: "150.00",
        kind: "WIN",
        roundId: "r-1",
      });

      expect(result.status).toBe("PROCESSED");
      expect(result.balance.amount).toBe("200.00");
      expect(wallet.balance).toBe("200.00");
      expect(
        created.some((c) => c.entityClass === WalletLedgerEntryEntity),
      ).toBe(true);
    });

    test("processes LOSS without changing balance or creating ledger entry", async () => {
      const wallet: MockWallet = {
        id: "w-1",
        playerId: "p-1",
        currency: "USD",
        balance: "50.00",
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const { orm, created } = createEmMock({ wallet });
      const service = new WageringService(orm, dummyMetrics);

      const result = await service.execute({
        idempotencyKey: "key-loss",
        providerId: "prov-1",
        externalTransactionId: "ext-loss",
        walletId: "w-1",
        playerId: "p-1",
        currency: "USD",
        amount: "0.00",
        kind: "LOSS",
        roundId: "r-1",
      });

      expect(result.status).toBe("PROCESSED");
      expect(result.balance.amount).toBe("50.00");
      expect(wallet.balance).toBe("50.00");
      expect(
        created.some((c) => c.entityClass === WalletLedgerEntryEntity),
      ).toBe(false);
    });

    test("processes WIN with optional reference to a PROCESSED BET in the same round", async () => {
      const wallet: MockWallet = {
        id: "w-1",
        playerId: "p-1",
        currency: "USD",
        balance: "50.00",
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const referenceBet: MockTransaction = {
        id: "tx-bet-1",
        playerId: "p-1",
        walletId: "w-1",
        currency: "USD",
        roundId: "r-1",
        amount: "20.00",
        kind: "BET",
        status: "PROCESSED",
        externalTransactionId: "bet-1",
      };

      const { orm, created } = createEmMock({
        wallet,
        referenceTx: referenceBet,
      });
      const service = new WageringService(orm, dummyMetrics);

      const result = await service.execute({
        idempotencyKey: "key-win-ref",
        providerId: "prov-1",
        externalTransactionId: "ext-win-ref",
        walletId: "w-1",
        playerId: "p-1",
        currency: "USD",
        amount: "100.00",
        kind: "WIN",
        roundId: "r-1",
        referenceExternalTransactionId: "bet-1",
      });

      expect(result.status).toBe("PROCESSED");
      expect(result.balance.amount).toBe("150.00");
      expect(wallet.balance).toBe("150.00");
      expect(
        created.some((c) => c.entityClass === WalletLedgerEntryEntity),
      ).toBe(true);
    });

    test("sets status to PENDING_REFERENCE when WIN references a missing BET", async () => {
      const wallet: MockWallet = {
        id: "w-1",
        playerId: "p-1",
        currency: "USD",
        balance: "50.00",
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const { orm } = createEmMock({ wallet, referenceTx: undefined });
      const service = new WageringService(orm, dummyMetrics);

      const result = await service.execute({
        idempotencyKey: "key-win-unresolved",
        providerId: "prov-1",
        externalTransactionId: "ext-win-unresolved",
        walletId: "w-1",
        playerId: "p-1",
        currency: "USD",
        amount: "50.00",
        kind: "WIN",
        roundId: "r-1",
        referenceExternalTransactionId: "missing-bet",
      });

      expect(result.status).toBe("PENDING_REFERENCE");
      expect(wallet.balance).toBe("50.00");
    });

    test("rejects WIN with INVALID_REFERENCE_KIND when referenced transaction is not a BET", async () => {
      const wallet: MockWallet = {
        id: "w-1",
        playerId: "p-1",
        currency: "USD",
        balance: "50.00",
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const referenceNonBet: MockTransaction = {
        id: "tx-prev-win",
        playerId: "p-1",
        walletId: "w-1",
        currency: "USD",
        roundId: "r-1",
        amount: "20.00",
        kind: "WIN",
        status: "PROCESSED",
        externalTransactionId: "win-1",
      };

      const { orm } = createEmMock({
        wallet,
        referenceTx: referenceNonBet,
      });
      const service = new WageringService(orm, dummyMetrics);

      const result = await service.execute({
        idempotencyKey: "key-win-invalid-kind",
        providerId: "prov-1",
        externalTransactionId: "ext-win-invalid-kind",
        walletId: "w-1",
        playerId: "p-1",
        currency: "USD",
        amount: "50.00",
        kind: "WIN",
        roundId: "r-1",
        referenceExternalTransactionId: "win-1",
      });

      expect(result.status).toBe("REJECTED");
      expect(result.failureCode).toBe("INVALID_REFERENCE_KIND");
      expect(wallet.balance).toBe("50.00");
    });

    test("rejects WIN with REFERENCE_SCOPE_MISMATCH when referenced BET belongs to another round", async () => {
      const wallet: MockWallet = {
        id: "w-1",
        playerId: "p-1",
        currency: "USD",
        balance: "50.00",
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const referenceOtherRound: MockTransaction = {
        id: "tx-bet-other",
        playerId: "p-1",
        walletId: "w-1",
        currency: "USD",
        roundId: "r-other",
        amount: "20.00",
        kind: "BET",
        status: "PROCESSED",
        externalTransactionId: "bet-other",
      };

      const { orm } = createEmMock({
        wallet,
        referenceTx: referenceOtherRound,
      });
      const service = new WageringService(orm, dummyMetrics);

      const result = await service.execute({
        idempotencyKey: "key-win-scope-mismatch",
        providerId: "prov-1",
        externalTransactionId: "ext-win-scope-mismatch",
        walletId: "w-1",
        playerId: "p-1",
        currency: "USD",
        amount: "50.00",
        kind: "WIN",
        roundId: "r-1",
        referenceExternalTransactionId: "bet-other",
      });

      expect(result.status).toBe("REJECTED");
      expect(result.failureCode).toBe("REFERENCE_SCOPE_MISMATCH");
    });

    test("rejects WIN with REFERENCE_NOT_PROCESSED when referenced BET is not processed", async () => {
      const wallet: MockWallet = {
        id: "w-1",
        playerId: "p-1",
        currency: "USD",
        balance: "50.00",
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const referenceUnprocessed: MockTransaction = {
        id: "tx-bet-pending",
        playerId: "p-1",
        walletId: "w-1",
        currency: "USD",
        roundId: "r-1",
        amount: "20.00",
        kind: "BET",
        status: "PENDING",
        externalTransactionId: "bet-pending",
      };

      const { orm } = createEmMock({
        wallet,
        referenceTx: referenceUnprocessed,
      });
      const service = new WageringService(orm, dummyMetrics);

      const result = await service.execute({
        idempotencyKey: "key-win-not-processed",
        providerId: "prov-1",
        externalTransactionId: "ext-win-not-processed",
        walletId: "w-1",
        playerId: "p-1",
        currency: "USD",
        amount: "50.00",
        kind: "WIN",
        roundId: "r-1",
        referenceExternalTransactionId: "bet-pending",
      });

      expect(result.status).toBe("REJECTED");
      expect(result.failureCode).toBe("REFERENCE_NOT_PROCESSED");
    });
  });

  describe("REFUND & ROLLBACK Reversals", () => {
    test("sets status to PENDING_REFERENCE when referenced transaction is missing", async () => {
      const wallet: MockWallet = {
        id: "w-1",
        playerId: "p-1",
        currency: "USD",
        balance: "50.00",
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const { orm } = createEmMock({ wallet, referenceTx: undefined });
      const service = new WageringService(orm, dummyMetrics);

      const result = await service.execute({
        idempotencyKey: "key-refund-unresolved",
        providerId: "prov-1",
        externalTransactionId: "ext-refund",
        walletId: "w-1",
        playerId: "p-1",
        currency: "USD",
        amount: "20.00",
        kind: "REFUND",
        roundId: "r-1",
        referenceExternalTransactionId: "non-existent-bet",
      });

      expect(result.status).toBe("PENDING_REFERENCE");
      expect(wallet.balance).toBe("50.00");
    });

    test("processes valid REFUND of processed BET by crediting wallet", async () => {
      const wallet: MockWallet = {
        id: "w-1",
        playerId: "p-1",
        currency: "USD",
        balance: "30.00",
        version: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const referenceBet: MockTransaction = {
        id: "tx-bet-1",
        playerId: "p-1",
        walletId: "w-1",
        currency: "USD",
        roundId: "r-1",
        amount: "20.00",
        kind: "BET",
        status: "PROCESSED",
        externalTransactionId: "bet-1",
      };

      const { orm, created } = createEmMock({
        wallet,
        referenceTx: referenceBet,
      });
      const service = new WageringService(orm, dummyMetrics);

      const result = await service.execute({
        idempotencyKey: "key-refund-ok",
        providerId: "prov-1",
        externalTransactionId: "ext-refund-ok",
        walletId: "w-1",
        playerId: "p-1",
        currency: "USD",
        amount: "20.00",
        kind: "REFUND",
        roundId: "r-1",
        referenceExternalTransactionId: "bet-1",
      });

      expect(result.status).toBe("PROCESSED");
      expect(result.balance.amount).toBe("50.00");
      expect(wallet.balance).toBe("50.00");
      expect(
        created.some((c) => c.entityClass === WalletLedgerEntryEntity),
      ).toBe(true);
    });

    test("rejects ROLLBACK with REVERSAL_WOULD_NEGATIVE when rolling back a WIN that exceeds current balance", async () => {
      const wallet: MockWallet = {
        id: "w-1",
        playerId: "p-1",
        currency: "USD",
        balance: "10.00",
        version: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const referenceWin: MockTransaction = {
        id: "tx-win-1",
        playerId: "p-1",
        walletId: "w-1",
        currency: "USD",
        roundId: "r-1",
        amount: "100.00",
        kind: "WIN",
        status: "PROCESSED",
        externalTransactionId: "win-1",
      };

      const { orm } = createEmMock({ wallet, referenceTx: referenceWin });
      const service = new WageringService(orm, dummyMetrics);

      const result = await service.execute({
        idempotencyKey: "key-rollback-fail",
        providerId: "prov-1",
        externalTransactionId: "ext-rollback-fail",
        walletId: "w-1",
        playerId: "p-1",
        currency: "USD",
        amount: "100.00",
        kind: "ROLLBACK",
        roundId: "r-1",
        referenceExternalTransactionId: "win-1",
      });

      expect(result.status).toBe("REJECTED");
      expect(result.failureCode).toBe("REVERSAL_WOULD_NEGATIVE");
      expect(wallet.balance).toBe("10.00");
    });
  });
});
