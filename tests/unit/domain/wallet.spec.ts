import { describe, expect, test } from "bun:test";
import { DomainError } from "../../../src/domain/shared/domain-error";
import { Money } from "../../../src/domain/shared/money";
import { Wallet } from "../../../src/domain/wallet/wallet";

describe("Wallet Aggregate Root", () => {
  test("opens with default zero balance and version 1", () => {
    const wallet = Wallet.open({ id: "w-1", playerId: "p-1", currency: "BRL" });
    expect(wallet.id).toBe("w-1");
    expect(wallet.playerId).toBe("p-1");
    expect(wallet.currency).toBe("BRL");
    expect(wallet.balance.amount).toBe("0.00");
    expect(wallet.version).toBe(1);
  });

  test("opens with initial positive balance", () => {
    const initial = Money.create("50.00", "USD");
    const wallet = Wallet.open({ id: "w-2", playerId: "p-2", currency: "USD", initialBalance: initial });
    expect(wallet.balance.amount).toBe("50.00");
    expect(wallet.version).toBe(1);
  });

  test("throws DomainError when opening with initial balance of differing currency", () => {
    const initialBrl = Money.create("50.00", "BRL");
    expect(() => Wallet.open({ id: "w-3", playerId: "p-3", currency: "USD", initialBalance: initialBrl })).toThrow(DomainError);
  });

  test("increments version and produces a reconcilable ledger entry on credit", () => {
    const wallet = Wallet.open({ id: "w-4", playerId: "p-4", currency: "BRL" });
    const entry = wallet.credit(Money.create("100.00", "BRL"), "tx-1", "entry-1");

    expect(wallet.version).toBe(2);
    expect(wallet.balance.amount).toBe("100.00");
    expect(entry.direction).toBe("CREDIT");
    expect(entry.balanceBefore.amount).toBe("0.00");
    expect(entry.balanceAfter.amount).toBe("100.00");
  });

  test("increments version and produces a reconcilable ledger entry on debit", () => {
    const initial = Money.create("100.00", "BRL");
    const wallet = Wallet.open({ id: "w-5", playerId: "p-5", currency: "BRL", initialBalance: initial });

    const entry = wallet.debit(Money.create("40.00", "BRL"), "tx-2", "entry-2");
    expect(wallet.version).toBe(2);
    expect(wallet.balance.amount).toBe("60.00");
    expect(entry.direction).toBe("DEBIT");
    expect(entry.balanceBefore.amount).toBe("100.00");
    expect(entry.balanceAfter.amount).toBe("60.00");
  });

  test("throws DomainError with INSUFFICIENT_FUNDS and does not mutate wallet when debit exceeds balance", () => {
    const wallet = Wallet.open({ id: "w-6", playerId: "p-6", currency: "BRL" });

    expect(() => wallet.debit(Money.create("0.01", "BRL"), "tx-3", "entry-3")).toThrow(DomainError);
    expect(wallet.balance.amount).toBe("0.00");
    expect(wallet.version).toBe(1);
  });

  test("throws DomainError when attempting to credit/debit zero or with differing currency", () => {
    const wallet = Wallet.open({ id: "w-7", playerId: "p-7", currency: "BRL" });

    expect(() => wallet.credit(Money.zero("BRL"), "tx-4", "entry-4")).toThrow(DomainError);
    expect(() => wallet.credit(Money.create("10.00", "USD"), "tx-5", "entry-5")).toThrow(DomainError);
    expect(() => wallet.debit(Money.create("10.00", "USD"), "tx-6", "entry-6")).toThrow(DomainError);
  });

  test("rehydrates correctly from persistence", () => {
    const now = new Date();
    const wallet = Wallet.rehydrate({
      id: "w-8",
      playerId: "p-8",
      currency: "EUR",
      balance: Money.create("250.00", "EUR"),
      version: 5,
      createdAt: now,
      updatedAt: now,
    });

    expect(wallet.id).toBe("w-8");
    expect(wallet.version).toBe(5);
    expect(wallet.balance.amount).toBe("250.00");
  });

  test("throws DomainError when rehydrating with invalid version or mismatched currency", () => {
    const now = new Date();
    expect(() =>
      Wallet.rehydrate({
        id: "w-9",
        playerId: "p-9",
        currency: "EUR",
        balance: Money.create("250.00", "USD"),
        version: 1,
        createdAt: now,
        updatedAt: now,
      }),
    ).toThrow(DomainError);

    expect(() =>
      Wallet.rehydrate({
        id: "w-10",
        playerId: "p-10",
        currency: "EUR",
        balance: Money.create("250.00", "EUR"),
        version: 0,
        createdAt: now,
        updatedAt: now,
      }),
    ).toThrow(DomainError);
  });
});
