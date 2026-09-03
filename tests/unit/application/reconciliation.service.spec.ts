import { describe, expect, test } from "bun:test";
import { ReconciliationService } from "../../../src/application/wallets/reconciliation.service";
import { WalletEntity } from "../../../src/infrastructure/persistence/entities/wallet.entity";
import { DomainError } from "../../../src/domain/shared/domain-error";

import type { MikroORM } from "@mikro-orm/postgresql";
import type { OperationalMetrics } from "../../../src/infrastructure/observability/operational-metrics";

describe("ReconciliationService Application Service", () => {
  const dummyMetrics = {
    increment: () => {},
    observe: () => {},
    gauge: () => {},
  } as unknown as OperationalMetrics;

  function createOrmMock(options: {
    wallet?: { id: string; balance: string; currency: string } | null;
    calculatedBalance?: string;
    checkedEntries?: string;
  }) {
    const executeMock = async () => [
      {
        calculatedBalance: options.calculatedBalance ?? "100.00",
        checkedEntries: options.checkedEntries ?? "5",
      },
    ];

    const findOneMock = async (entityClass: unknown, where: { id?: string }) => {
      if (entityClass === WalletEntity) {
        if (options.wallet === null) return null;
        return options.wallet ?? { id: where.id, balance: "100.00", currency: "BRL" };
      }
      return null;
    };

    const em = {
      fork: () => em,
      findOne: findOneMock,
      getConnection: () => ({
        execute: executeMock,
      }),
    };

    return {
      em,
    } as unknown as MikroORM;
  }

  test("returns structured monetary amounts for storedBalance, calculatedBalance, and difference when consistent", async () => {
    const orm = createOrmMock({
      wallet: { id: "w-1", balance: "100.00", currency: "BRL" },
      calculatedBalance: "100.00",
      checkedEntries: "3",
    });
    const service = new ReconciliationService(orm, dummyMetrics);

    const result = await service.reconcile("w-1");

    expect(result.walletId).toBe("w-1");
    expect(result.consistent).toBe(true);
    expect(result.checkedEntries).toBe(3);
    expect(result.storedBalance).toEqual({ amount: "100.00", currency: "BRL" });
    expect(result.calculatedBalance).toEqual({ amount: "100.00", currency: "BRL" });
    expect(result.difference).toEqual({ amount: "0.00", currency: "BRL" });
  });

  test("returns structured monetary amounts and consistent: false when divergence exists", async () => {
    const orm = createOrmMock({
      wallet: { id: "w-2", balance: "95.00", currency: "USD" },
      calculatedBalance: "80.00",
      checkedEntries: "2",
    });
    const service = new ReconciliationService(orm, dummyMetrics);

    const result = await service.reconcile("w-2");

    expect(result.walletId).toBe("w-2");
    expect(result.consistent).toBe(false);
    expect(result.storedBalance).toEqual({ amount: "95.00", currency: "USD" });
    expect(result.calculatedBalance).toEqual({ amount: "80.00", currency: "USD" });
    expect(result.difference).toEqual({ amount: "15.00", currency: "USD" });
  });

  test("throws WALLET_NOT_FOUND when wallet is missing", async () => {
    const orm = createOrmMock({ wallet: null });
    const service = new ReconciliationService(orm, dummyMetrics);

    await expect(service.reconcile("non-existent")).rejects.toThrow(DomainError);
  });
});
