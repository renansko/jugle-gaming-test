import { describe, expect, mock, test } from "bun:test";
import type { EntityManager, MikroORM } from "@mikro-orm/postgresql";
import {
  type ProcessWagerInput,
  WageringService,
} from "../../../src/application/wagering/wagering.service";
import { WagerTransactionEntity } from "../../../src/infrastructure/persistence/entities/wager-transaction.entity";
import { WalletEntity } from "../../../src/infrastructure/persistence/entities/wallet.entity";
import { WalletLedgerEntryEntity } from "../../../src/infrastructure/persistence/entities/wallet-ledger-entry.entity";
import type { OperationalMetrics } from "../../../src/infrastructure/observability/operational-metrics";
import { SettableClock } from "../../../src/domain/common/clock";
import { DeterministicIdGenerator } from "../../../src/domain/common/id-generator";
import type { ZeroBackoffPolicy } from "../../../src/domain/common/backoff-policy";
import { ConcurrencyBarrier } from "../../support/concurrency-barrier";

type MockTransaction = Partial<WagerTransactionEntity>;
type MockWallet = Partial<WalletEntity>;

describe("Deterministic Concurrency & Reversals (Issue #17)", () => {
  const dummyMetrics = {
    increment: mock(() => {}),
    observe: mock(() => {}),
  } as unknown as OperationalMetrics;

  const buildHarness = (options: {
    wallet: MockWallet;
    transactions?: MockTransaction[];
    clock?: SettableClock;
    idGenerator?: DeterministicIdGenerator;
    backoffPolicy?: ZeroBackoffPolicy;
    hooks?: Record<string, (input: ProcessWagerInput) => Promise<void> | void>;
  }) => {
    const transactions = options.transactions ?? [];
    const ledgerEntries: WalletLedgerEntryEntity[] = [];

    const em = {
      findOne: mock(
        async (entityClass: unknown, filter: Record<string, unknown>) => {
          if (entityClass === WalletEntity) {
            if (filter.id === options.wallet.id) {
              return options.wallet;
            }
            return null;
          }
          if (entityClass === WagerTransactionEntity) {
            if (filter.idempotencyKey) {
              return (
                transactions.find(
                  (t) => t.idempotencyKey === filter.idempotencyKey,
                ) ?? null
              );
            }
            if (filter.providerId && filter.externalTransactionId) {
              return (
                transactions.find(
                  (t) =>
                    t.providerId === filter.providerId &&
                    t.externalTransactionId === filter.externalTransactionId,
                ) ?? null
              );
            }
            if (filter.externalTransactionId && !filter.providerId) {
              return (
                transactions.find(
                  (t) =>
                    t.externalTransactionId === filter.externalTransactionId,
                ) ?? null
              );
            }
            if (filter.referenceTransactionId && filter.kind) {
              return (
                transactions.find(
                  (t) =>
                    t.referenceTransactionId ===
                      filter.referenceTransactionId &&
                    t.kind === filter.kind &&
                    (!filter.id ||
                      (typeof filter.id === "object" && "$ne" in filter.id
                        ? t.id !== (filter.id as { $ne: string }).$ne
                        : t.id === filter.id)),
                ) ?? null
              );
            }
            if (filter.id) {
              return transactions.find((t) => t.id === filter.id) ?? null;
            }
          }
          return null;
        },
      ),
      create: mock((entityClass: unknown, data: Record<string, unknown>) => {
        if (entityClass === WagerTransactionEntity) {
          const entity = { ...data } as unknown as WagerTransactionEntity;
          transactions.push(entity);
          return entity;
        }
        if (entityClass === WalletLedgerEntryEntity) {
          const entry = { ...data } as unknown as WalletLedgerEntryEntity;
          ledgerEntries.push(entry);
          return entry;
        }
        return data;
      }),
      persist: mock((entity: unknown) => {
        if (
          entity &&
          typeof entity === "object" &&
          !("id" in entity && entity.id)
        ) {
          (entity as { id: string }).id = "generated-id";
        }
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

    const service = new WageringService(
      orm,
      dummyMetrics,
      options.clock,
      options.idGenerator,
      options.backoffPolicy,
      options.hooks,
    );

    return { service, wallet: options.wallet, transactions, ledgerEntries };
  };

  describe("Reversal Matrix (REFUND of BET, ROLLBACK of BET, WIN, REFUND)", () => {
    test("processes valid ROLLBACK of a processed BET by crediting wallet", async () => {
      const wallet: MockWallet = {
        id: "w-1",
        playerId: "p-1",
        currency: "BRL",
        balance: "50.00",
        version: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const bet: MockTransaction = {
        id: "tx-bet-1",
        providerId: "prov-1",
        externalTransactionId: "ext-bet-1",
        walletId: "w-1",
        playerId: "p-1",
        currency: "BRL",
        roundId: "r-1",
        amount: "50.00",
        kind: "BET",
        status: "PROCESSED",
      };

      const { service, ledgerEntries } = buildHarness({
        wallet,
        transactions: [bet],
      });

      const result = await service.execute({
        idempotencyKey: "idem-rb-bet",
        providerId: "prov-1",
        externalTransactionId: "ext-rb-bet",
        walletId: "w-1",
        playerId: "p-1",
        currency: "BRL",
        amount: "50.00",
        kind: "ROLLBACK",
        roundId: "r-1",
        referenceExternalTransactionId: "ext-bet-1",
      });

      expect(result.status).toBe("PROCESSED");
      expect(result.balance.amount).toBe("100.00");
      expect(wallet.balance).toBe("100.00");
      expect(ledgerEntries).toHaveLength(1);
      expect(ledgerEntries[0]?.direction).toBe("CREDIT");
      expect(ledgerEntries[0]?.amount).toBe("50.00");
    });

    test("processes valid ROLLBACK of a processed WIN by debiting wallet", async () => {
      const wallet: MockWallet = {
        id: "w-1",
        playerId: "p-1",
        currency: "BRL",
        balance: "150.00",
        version: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const win: MockTransaction = {
        id: "tx-win-1",
        providerId: "prov-1",
        externalTransactionId: "ext-win-1",
        walletId: "w-1",
        playerId: "p-1",
        currency: "BRL",
        roundId: "r-1",
        amount: "70.00",
        kind: "WIN",
        status: "PROCESSED",
      };

      const { service, ledgerEntries } = buildHarness({
        wallet,
        transactions: [win],
      });

      const result = await service.execute({
        idempotencyKey: "idem-rb-win",
        providerId: "prov-1",
        externalTransactionId: "ext-rb-win",
        walletId: "w-1",
        playerId: "p-1",
        currency: "BRL",
        amount: "70.00",
        kind: "ROLLBACK",
        roundId: "r-1",
        referenceExternalTransactionId: "ext-win-1",
      });

      expect(result.status).toBe("PROCESSED");
      expect(result.balance.amount).toBe("80.00");
      expect(wallet.balance).toBe("80.00");
      expect(ledgerEntries).toHaveLength(1);
      expect(ledgerEntries[0]?.direction).toBe("DEBIT");
      expect(ledgerEntries[0]?.amount).toBe("70.00");
    });

    test("processes valid ROLLBACK of a processed REFUND by debiting wallet", async () => {
      const wallet: MockWallet = {
        id: "w-1",
        playerId: "p-1",
        currency: "BRL",
        balance: "100.00",
        version: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const refund: MockTransaction = {
        id: "tx-ref-1",
        providerId: "prov-1",
        externalTransactionId: "ext-ref-1",
        walletId: "w-1",
        playerId: "p-1",
        currency: "BRL",
        roundId: "r-1",
        amount: "40.00",
        kind: "REFUND",
        status: "PROCESSED",
      };

      const { service, ledgerEntries } = buildHarness({
        wallet,
        transactions: [refund],
      });

      const result = await service.execute({
        idempotencyKey: "idem-rb-ref",
        providerId: "prov-1",
        externalTransactionId: "ext-rb-ref",
        walletId: "w-1",
        playerId: "p-1",
        currency: "BRL",
        amount: "40.00",
        kind: "ROLLBACK",
        roundId: "r-1",
        referenceExternalTransactionId: "ext-ref-1",
      });

      expect(result.status).toBe("PROCESSED");
      expect(result.balance.amount).toBe("60.00");
      expect(wallet.balance).toBe("60.00");
      expect(ledgerEntries).toHaveLength(1);
      expect(ledgerEntries[0]?.direction).toBe("DEBIT");
      expect(ledgerEntries[0]?.amount).toBe("40.00");
    });

    test("rejects ROLLBACK of REFUND with REVERSAL_WOULD_NEGATIVE when wallet funds are insufficient", async () => {
      const wallet: MockWallet = {
        id: "w-1",
        playerId: "p-1",
        currency: "BRL",
        balance: "20.00",
        version: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const refund: MockTransaction = {
        id: "tx-ref-1",
        providerId: "prov-1",
        externalTransactionId: "ext-ref-1",
        walletId: "w-1",
        playerId: "p-1",
        currency: "BRL",
        roundId: "r-1",
        amount: "50.00",
        kind: "REFUND",
        status: "PROCESSED",
      };

      const { service, ledgerEntries } = buildHarness({
        wallet,
        transactions: [refund],
      });

      const result = await service.execute({
        idempotencyKey: "idem-rb-ref-fail",
        providerId: "prov-1",
        externalTransactionId: "ext-rb-ref-fail",
        walletId: "w-1",
        playerId: "p-1",
        currency: "BRL",
        amount: "50.00",
        kind: "ROLLBACK",
        roundId: "r-1",
        referenceExternalTransactionId: "ext-ref-1",
      });

      expect(result.status).toBe("REJECTED");
      expect(result.failureCode).toBe("REVERSAL_WOULD_NEGATIVE");
      expect(wallet.balance).toBe("20.00");
      expect(ledgerEntries).toHaveLength(0);
    });

    test("rejects REFUND of a WIN with INVALID_REFERENCE_KIND", async () => {
      const wallet: MockWallet = {
        id: "w-1",
        playerId: "p-1",
        currency: "BRL",
        balance: "100.00",
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const win: MockTransaction = {
        id: "tx-win-1",
        providerId: "prov-1",
        externalTransactionId: "ext-win-1",
        walletId: "w-1",
        playerId: "p-1",
        currency: "BRL",
        roundId: "r-1",
        amount: "30.00",
        kind: "WIN",
        status: "PROCESSED",
      };

      const { service, ledgerEntries } = buildHarness({
        wallet,
        transactions: [win],
      });

      const result = await service.execute({
        idempotencyKey: "idem-ref-win",
        providerId: "prov-1",
        externalTransactionId: "ext-ref-win",
        walletId: "w-1",
        playerId: "p-1",
        currency: "BRL",
        amount: "30.00",
        kind: "REFUND",
        roundId: "r-1",
        referenceExternalTransactionId: "ext-win-1",
      });

      expect(result.status).toBe("REJECTED");
      expect(result.failureCode).toBe("INVALID_REFERENCE_KIND");
      expect(ledgerEntries).toHaveLength(0);
    });

    test("rejects ROLLBACK of a LOSS with INVALID_REFERENCE_KIND", async () => {
      const wallet: MockWallet = {
        id: "w-1",
        playerId: "p-1",
        currency: "BRL",
        balance: "100.00",
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const loss: MockTransaction = {
        id: "tx-loss-1",
        providerId: "prov-1",
        externalTransactionId: "ext-loss-1",
        walletId: "w-1",
        playerId: "p-1",
        currency: "BRL",
        roundId: "r-1",
        amount: "10.00",
        kind: "LOSS",
        status: "PROCESSED",
      };

      const { service, ledgerEntries } = buildHarness({
        wallet,
        transactions: [loss],
      });

      const result = await service.execute({
        idempotencyKey: "idem-rb-loss",
        providerId: "prov-1",
        externalTransactionId: "ext-rb-loss",
        walletId: "w-1",
        playerId: "p-1",
        currency: "BRL",
        amount: "10.00",
        kind: "ROLLBACK",
        roundId: "r-1",
        referenceExternalTransactionId: "ext-loss-1",
      });

      expect(result.status).toBe("REJECTED");
      expect(result.failureCode).toBe("INVALID_REFERENCE_KIND");
      expect(ledgerEntries).toHaveLength(0);
    });
  });

  describe("Duplicate Reversals Protection", () => {
    test("rejects second reversal of same kind with REFERENCE_ALREADY_REVERSED without financial entry", async () => {
      const wallet: MockWallet = {
        id: "w-1",
        playerId: "p-1",
        currency: "BRL",
        balance: "70.00",
        version: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const bet: MockTransaction = {
        id: "tx-bet-1",
        providerId: "prov-1",
        externalTransactionId: "ext-bet-1",
        walletId: "w-1",
        playerId: "p-1",
        currency: "BRL",
        roundId: "r-1",
        amount: "30.00",
        kind: "BET",
        status: "PROCESSED",
      };
      const existingRefund: MockTransaction = {
        id: "tx-ref-prev",
        providerId: "prov-1",
        externalTransactionId: "ext-ref-prev",
        walletId: "w-1",
        playerId: "p-1",
        currency: "BRL",
        roundId: "r-1",
        amount: "30.00",
        kind: "REFUND",
        status: "PROCESSED",
        referenceTransactionId: "tx-bet-1",
      };

      const { service, ledgerEntries } = buildHarness({
        wallet,
        transactions: [bet, existingRefund],
      });

      const result = await service.execute({
        idempotencyKey: "idem-ref-dup",
        providerId: "prov-1",
        externalTransactionId: "ext-ref-dup",
        walletId: "w-1",
        playerId: "p-1",
        currency: "BRL",
        amount: "30.00",
        kind: "REFUND",
        roundId: "r-1",
        referenceExternalTransactionId: "ext-bet-1",
      });

      expect(result.status).toBe("REJECTED");
      expect(result.failureCode).toBe("REFERENCE_ALREADY_REVERSED");
      expect(wallet.balance).toBe("70.00");
      expect(ledgerEntries).toHaveLength(0);
    });
  });

  describe("Divergence Matrix & Stable Failure Codes", () => {
    const baseWallet: MockWallet = {
      id: "w-1",
      playerId: "p-1",
      currency: "BRL",
      balance: "100.00",
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const baseBet: MockTransaction = {
      id: "tx-bet-base",
      providerId: "prov-correct",
      externalTransactionId: "ext-bet-base",
      walletId: "w-1",
      playerId: "p-1",
      currency: "BRL",
      roundId: "round-100",
      amount: "25.00",
      kind: "BET",
      status: "PROCESSED",
    };

    test("divergent providerId rejects with REFERENCE_SCOPE_MISMATCH without ledger entry", async () => {
      const { service, ledgerEntries } = buildHarness({
        wallet: baseWallet,
        transactions: [baseBet],
      });

      const result = await service.execute({
        idempotencyKey: "idem-diff-prov",
        providerId: "prov-DIFFERENT",
        externalTransactionId: "ext-ref-prov",
        walletId: "w-1",
        playerId: "p-1",
        currency: "BRL",
        amount: "25.00",
        kind: "REFUND",
        roundId: "round-100",
        referenceExternalTransactionId: "ext-bet-base",
      });

      expect(result.status).toBe("REJECTED");
      expect(result.failureCode).toBe("REFERENCE_SCOPE_MISMATCH");
      expect(ledgerEntries).toHaveLength(0);
    });

    test("divergent playerId rejects with REFERENCE_SCOPE_MISMATCH without ledger entry", async () => {
      const { service, ledgerEntries } = buildHarness({
        wallet: baseWallet,
        transactions: [baseBet],
      });

      const result = await service.execute({
        idempotencyKey: "idem-diff-player",
        providerId: "prov-correct",
        externalTransactionId: "ext-ref-player",
        walletId: "w-1",
        playerId: "p-DIFFERENT",
        currency: "BRL",
        amount: "25.00",
        kind: "REFUND",
        roundId: "round-100",
        referenceExternalTransactionId: "ext-bet-base",
      });

      expect(result.status).toBe("REJECTED");
      expect(result.failureCode).toBe("REFERENCE_SCOPE_MISMATCH");
      expect(ledgerEntries).toHaveLength(0);
    });

    test("divergent roundId rejects with REFERENCE_SCOPE_MISMATCH without ledger entry", async () => {
      const { service, ledgerEntries } = buildHarness({
        wallet: baseWallet,
        transactions: [baseBet],
      });

      const result = await service.execute({
        idempotencyKey: "idem-diff-round",
        providerId: "prov-correct",
        externalTransactionId: "ext-ref-round",
        walletId: "w-1",
        playerId: "p-1",
        currency: "BRL",
        amount: "25.00",
        kind: "REFUND",
        roundId: "round-DIFFERENT",
        referenceExternalTransactionId: "ext-bet-base",
      });

      expect(result.status).toBe("REJECTED");
      expect(result.failureCode).toBe("REFERENCE_SCOPE_MISMATCH");
      expect(ledgerEntries).toHaveLength(0);
    });

    test("divergent amount rejects with REFERENCE_AMOUNT_MISMATCH without ledger entry", async () => {
      const { service, ledgerEntries } = buildHarness({
        wallet: baseWallet,
        transactions: [baseBet],
      });

      const result = await service.execute({
        idempotencyKey: "idem-diff-amount",
        providerId: "prov-correct",
        externalTransactionId: "ext-ref-amount",
        walletId: "w-1",
        playerId: "p-1",
        currency: "BRL",
        amount: "99.00",
        kind: "REFUND",
        roundId: "round-100",
        referenceExternalTransactionId: "ext-bet-base",
      });

      expect(result.status).toBe("REJECTED");
      expect(result.failureCode).toBe("REFERENCE_AMOUNT_MISMATCH");
      expect(ledgerEntries).toHaveLength(0);
    });
  });

  describe("Injectable Clock, IdGenerator, and Backoff Control", () => {
    test("injected SettableClock controls timestamps without system clock drift", async () => {
      const fixedTime = new Date("2026-09-02T10:00:00.000Z");
      const clock = new SettableClock(fixedTime);
      const idGen = new DeterministicIdGenerator(["tx-fixed-id"]);

      const wallet: MockWallet = {
        id: "w-1",
        playerId: "p-1",
        currency: "BRL",
        balance: "100.00",
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const { service, transactions } = buildHarness({
        wallet,
        clock,
        idGenerator: idGen,
      });

      const result = await service.execute({
        idempotencyKey: "idem-clock",
        providerId: "prov-1",
        externalTransactionId: "ext-clock",
        walletId: "w-1",
        playerId: "p-1",
        currency: "BRL",
        amount: "10.00",
        kind: "BET",
        roundId: "r-1",
      });

      expect(result.status).toBe("PROCESSED");
      expect(result.id).toBe("tx-fixed-id");
      const persistedTx = transactions.find((t) => t.id === "tx-fixed-id");
      expect(persistedTx?.createdAt).toEqual(fixedTime);
    });
  });

  describe("Deterministic Race with ConcurrencyBarrier", () => {
    test("two simultaneous reversals synchronize via barrier and produce exactly one financial entry", async () => {
      const wallet: MockWallet = {
        id: "w-race-1",
        playerId: "p-race-1",
        currency: "BRL",
        balance: "100.00",
        version: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const bet: MockTransaction = {
        id: "tx-bet-race",
        providerId: "prov-race",
        externalTransactionId: "ext-bet-race",
        walletId: "w-race-1",
        playerId: "p-race-1",
        currency: "BRL",
        roundId: "round-race-1",
        amount: "40.00",
        kind: "BET",
        status: "PROCESSED",
      };

      const barrier = new ConcurrencyBarrier(2);
      let lockTurn = 0;

      const { service, ledgerEntries } = buildHarness({
        wallet,
        transactions: [bet],
        hooks: {
          beforeLock: async () => {
            // Both concurrent requests wait here until both have arrived
            await barrier.await();
            // Simulate serialized wallet lock: second caller yields slightly to let first complete
            const turn = lockTurn++;
            if (turn === 1) {
              await new Promise((r) => setTimeout(r, 5));
            }
          },
        },
      });

      const [res1, res2] = await Promise.all([
        service.execute({
          idempotencyKey: "idem-rev-1",
          providerId: "prov-race",
          externalTransactionId: "ext-rev-1",
          walletId: "w-race-1",
          playerId: "p-race-1",
          currency: "BRL",
          amount: "40.00",
          kind: "REFUND",
          roundId: "round-race-1",
          referenceExternalTransactionId: "ext-bet-race",
        }),
        service.execute({
          idempotencyKey: "idem-rev-2",
          providerId: "prov-race",
          externalTransactionId: "ext-rev-2",
          walletId: "w-race-1",
          playerId: "p-race-1",
          currency: "BRL",
          amount: "40.00",
          kind: "REFUND",
          roundId: "round-race-1",
          referenceExternalTransactionId: "ext-bet-race",
        }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual(["PROCESSED", "REJECTED"]);

      const rejected = res1.status === "REJECTED" ? res1 : res2;
      expect(rejected.failureCode).toBe("REFERENCE_ALREADY_REVERSED");

      // Balance should have increased by exactly one refund of 40.00: 100.00 + 40.00 = 140.00
      expect(wallet.balance).toBe("140.00");

      // Ledger invariant: exactly 1 financial entry created
      expect(ledgerEntries).toHaveLength(1);
      expect(ledgerEntries[0]?.direction).toBe("CREDIT");
      expect(ledgerEntries[0]?.amount).toBe("40.00");

      // Mathematical reconstruction from ledger
      const initialBalance = 100.0;
      const ledgerCredits = ledgerEntries
        .filter((e) => e.direction === "CREDIT")
        .reduce((sum, e) => sum + Number.parseFloat(e.amount), 0);
      const ledgerDebits = ledgerEntries
        .filter((e) => e.direction === "DEBIT")
        .reduce((sum, e) => sum + Number.parseFloat(e.amount), 0);
      const reconstructedBalance = initialBalance + ledgerCredits - ledgerDebits;

      expect(Number.parseFloat(wallet.balance ?? "0.00")).toBe(reconstructedBalance);
    });
  });
});

