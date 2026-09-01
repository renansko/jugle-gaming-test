import { describe, expect, mock, test } from "bun:test";
import type { EntityManager, MikroORM } from "@mikro-orm/postgresql";
import { WalletService } from "../../../src/application/wallets/wallet.service";
import { DomainError } from "../../../src/domain/shared/domain-error";
import { WalletEntity } from "../../../src/infrastructure/persistence/entities/wallet.entity";
import { WagerTransactionEntity } from "../../../src/infrastructure/persistence/entities/wager-transaction.entity";
import { WalletLedgerEntryEntity } from "../../../src/infrastructure/persistence/entities/wallet-ledger-entry.entity";

describe("WalletService Application Service", () => {
  test("creates wallet with zero balance without generating ledger entry", async () => {
    const createdEntities: Array<{ entityClass: unknown; data: unknown }> = [];
    const persistedEntities: unknown[] = [];

    const emMock = {
      create: mock((entityClass: unknown, data: unknown) => {
        createdEntities.push({ entityClass, data });
        return data;
      }),
      persist: mock((entities: unknown) => {
        persistedEntities.push(entities);
      }),
      flush: mock(async () => {}),
      persistAndFlush: mock(async (entity: unknown) => {
        persistedEntities.push(entity);
      }),
    } as unknown as EntityManager;

    const ormMock = {
      em: {
        transactional: mock(
          async (cb: (em: EntityManager) => Promise<unknown>) => cb(emMock),
        ),
      },
    } as unknown as MikroORM;

    const service = new WalletService(ormMock);
    const result = await service.create({
      playerId: "player-1",
      currency: "BRL",
    });

    expect(result.playerId).toBe("player-1");
    expect(result.currency).toBe("BRL");
    expect(result.balance).toBe("0.00");
    expect(createdEntities.length).toBe(1);
    expect(createdEntities[0]?.entityClass).toBe(WalletEntity);
  });

  test("creates wallet with positive balance atomic with OPENING transaction and ledger entry", async () => {
    const createdEntities: Array<{
      entityClass: unknown;
      data: Record<string, unknown>;
    }> = [];
    const persistedEntities: unknown[] = [];

    const emMock = {
      create: mock((entityClass: unknown, data: Record<string, unknown>) => {
        createdEntities.push({ entityClass, data });
        return data;
      }),
      persist: mock((entities: unknown) => {
        persistedEntities.push(entities);
      }),
      flush: mock(async () => {}),
      persistAndFlush: mock(async (entity: unknown) => {
        persistedEntities.push(entity);
      }),
    } as unknown as EntityManager;

    const ormMock = {
      em: {
        transactional: mock(
          async (cb: (em: EntityManager) => Promise<unknown>) => cb(emMock),
        ),
      },
    } as unknown as MikroORM;

    const service = new WalletService(ormMock);
    const result = await service.create({
      playerId: "player-2",
      currency: "USD",
      initialBalance: "150.00",
    });

    expect(result.balance).toBe("150.00");
    expect(createdEntities.some((c) => c.entityClass === WalletEntity)).toBe(
      true,
    );
    expect(
      createdEntities.some((c) => c.entityClass === WagerTransactionEntity),
    ).toBe(true);
    expect(
      createdEntities.some((c) => c.entityClass === WalletLedgerEntryEntity),
    ).toBe(true);

    const openingTx = createdEntities.find(
      (c) => c.entityClass === WagerTransactionEntity,
    );
    expect(openingTx?.data.kind).toBe("OPENING");
    expect(openingTx?.data.status).toBe("PROCESSED");

    const ledgerEntry = createdEntities.find(
      (c) => c.entityClass === WalletLedgerEntryEntity,
    );
    expect(ledgerEntry?.data.direction).toBe("CREDIT");
    expect(ledgerEntry?.data.amount).toBe("150.00");
    expect(ledgerEntry?.data.balanceBefore).toBe("0.00");
    expect(ledgerEntry?.data.balanceAfter).toBe("150.00");
  });

  test("throws WALLET_ALREADY_EXISTS on unique constraint violation", async () => {
    const ormMock = {
      em: {
        transactional: mock(async () => {
          const err = new Error("Unique constraint violation") as Error & {
            code?: string;
          };
          err.code = "23505";
          throw err;
        }),
      },
    } as unknown as MikroORM;

    const service = new WalletService(ormMock);
    await expect(
      service.create({ playerId: "player-1", currency: "BRL" }),
    ).rejects.toThrow(DomainError);
    try {
      await service.create({ playerId: "player-1", currency: "BRL" });
    } catch (e) {
      expect((e as DomainError).code).toBe("WALLET_ALREADY_EXISTS");
    }
  });

  describe("Ledger Pagination", () => {
    test("throws INVALID_CURSOR when decoding malformed base64 or invalid json cursor", async () => {
      const ormMock = {
        em: {
          fork: mock(() => ({
            getConnection: mock(() => ({
              execute: mock(async () => []),
            })),
          })),
        },
      } as unknown as MikroORM;

      const service = new WalletService(ormMock);
      await expect(
        service.ledger("w-1", "invalid_cursor_string", 10),
      ).rejects.toThrow(DomainError);
    });

    test("returns items and nextCursor when result exceeds limit", async () => {
      const now = new Date("2026-08-31T12:00:00.000Z");
      const rows = [
        {
          id: "e-1",
          direction: "CREDIT",
          amount: "50.00",
          currency: "USD",
          balanceBefore: "0.00",
          balanceAfter: "50.00",
          createdAt: now,
        },
        {
          id: "e-2",
          direction: "DEBIT",
          amount: "20.00",
          currency: "USD",
          balanceBefore: "50.00",
          balanceAfter: "30.00",
          createdAt: now,
        },
        {
          id: "e-3",
          direction: "CREDIT",
          amount: "10.00",
          currency: "USD",
          balanceBefore: "30.00",
          balanceAfter: "40.00",
          createdAt: now,
        },
      ];

      const ormMock = {
        em: {
          fork: mock(() => ({
            getConnection: mock(() => ({
              execute: mock(async () => rows),
            })),
          })),
        },
      } as unknown as MikroORM;

      const service = new WalletService(ormMock);
      const page = await service.ledger("w-1", undefined, 2);

      expect(page.items.length).toBe(2);
      expect(page.nextCursor).toBeDefined();
    });
  });
});
