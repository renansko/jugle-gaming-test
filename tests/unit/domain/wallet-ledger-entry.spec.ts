import { describe, expect, test } from "bun:test";
import { DomainError } from "../../../src/domain/shared/domain-error";
import { Money } from "../../../src/domain/shared/money";
import { WalletLedgerEntry } from "../../../src/domain/wallet/wallet-ledger-entry";

describe("WalletLedgerEntry Domain Entity", () => {
  test("creates a valid CREDIT ledger entry with mathematical reconciliation", () => {
    const before = Money.create("100.00", "USD");
    const amount = Money.create("50.00", "USD");
    const after = Money.create("150.00", "USD");

    const entry = WalletLedgerEntry.create({
      id: "entry-1",
      walletId: "wallet-1",
      transactionId: "tx-1",
      direction: "CREDIT",
      money: amount,
      balanceBefore: before,
      balanceAfter: after,
    });

    expect(entry.id).toBe("entry-1");
    expect(entry.direction).toBe("CREDIT");
    expect(entry.money.amount).toBe("50.00");
    expect(entry.balanceBefore.amount).toBe("100.00");
    expect(entry.balanceAfter.amount).toBe("150.00");
  });

  test("creates a valid DEBIT ledger entry with mathematical reconciliation", () => {
    const before = Money.create("100.00", "USD");
    const amount = Money.create("30.00", "USD");
    const after = Money.create("70.00", "USD");

    const entry = WalletLedgerEntry.create({
      id: "entry-2",
      walletId: "wallet-1",
      transactionId: "tx-2",
      direction: "DEBIT",
      money: amount,
      balanceBefore: before,
      balanceAfter: after,
    });

    expect(entry.direction).toBe("DEBIT");
    expect(entry.money.amount).toBe("30.00");
    expect(entry.balanceBefore.amount).toBe("100.00");
    expect(entry.balanceAfter.amount).toBe("70.00");
  });

  test("throws DomainError when CREDIT balance does not reconcile (before + amount != after)", () => {
    const before = Money.create("100.00", "USD");
    const amount = Money.create("50.00", "USD");
    const invalidAfter = Money.create("160.00", "USD"); // Erro proposital

    expect(() =>
      WalletLedgerEntry.create({
        id: "entry-3",
        walletId: "wallet-1",
        transactionId: "tx-3",
        direction: "CREDIT",
        money: amount,
        balanceBefore: before,
        balanceAfter: invalidAfter,
      }),
    ).toThrow(DomainError);
  });

  test("throws DomainError when DEBIT balance does not reconcile (before - amount != after)", () => {
    const before = Money.create("100.00", "USD");
    const amount = Money.create("40.00", "USD");
    const invalidAfter = Money.create("50.00", "USD"); // Deveria ser 60.00

    expect(() =>
      WalletLedgerEntry.create({
        id: "entry-4",
        walletId: "wallet-1",
        transactionId: "tx-4",
        direction: "DEBIT",
        money: amount,
        balanceBefore: before,
        balanceAfter: invalidAfter,
      }),
    ).toThrow(DomainError);
  });

  test("throws DomainError when currencies between before and amount differ", () => {
    const before = Money.create("100.00", "USD");
    const amountBrl = Money.create("50.00", "BRL");
    const after = Money.create("150.00", "USD");

    expect(() =>
      WalletLedgerEntry.create({
        id: "entry-5",
        walletId: "wallet-1",
        transactionId: "tx-5",
        direction: "CREDIT",
        money: amountBrl,
        balanceBefore: before,
        balanceAfter: after,
      }),
    ).toThrow(DomainError);
  });
});
