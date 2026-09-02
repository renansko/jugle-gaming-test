import { describe, expect, test } from "bun:test";
import { DomainError } from "../../../src/domain/shared/domain-error";
import { Money } from "../../../src/domain/shared/money";

describe("Money Domain Value Object", () => {
  test("normalizes exact decimal values without floating point drift", () => {
    const sum = Money.create("0.1", "BRL").add(Money.create("0.2", "BRL"));
    expect(sum.amount).toBe("0.30");
    expect(sum.currency).toBe("BRL");
  });

  test("subtracts exact amounts correctly", () => {
    const result = Money.create("100.00", "USD").subtract(
      Money.create("25.50", "USD"),
    );
    expect(result.amount).toBe("74.50");
    expect(result.currency).toBe("USD");
  });

  test("throws DomainError with INSUFFICIENT_FUNDS when subtraction results in negative", () => {
    const a = Money.create("10.00", "USD");
    const b = Money.create("10.01", "USD");

    expect(() => a.subtract(b)).toThrow(DomainError);
    try {
      a.subtract(b);
    } catch (e) {
      expect((e as DomainError).code).toBe("INSUFFICIENT_FUNDS");
    }
  });

  test("throws DomainError with CURRENCY_MISMATCH when performing operations between different currencies", () => {
    const brl = Money.create("100.00", "BRL");
    const usd = Money.create("100.00", "USD");

    expect(() => brl.add(usd)).toThrow(DomainError);
    expect(() => brl.subtract(usd)).toThrow(DomainError);
  });

  test("checks equality and zero values correctly", () => {
    const zeroUsd = Money.zero("USD");
    expect(zeroUsd.isZero()).toBe(true);
    expect(zeroUsd.amount).toBe("0.00");
    expect(zeroUsd.equals(Money.create("0.00", "USD"))).toBe(true);
    expect(zeroUsd.equals(Money.create("0.00", "BRL"))).toBe(false);
  });

  test("compares amounts of same currency and checks positive values", () => {
    const ten = Money.create("10.00", "BRL");
    const twenty = Money.create("20.00", "BRL");
    const tenAgain = Money.create("10.00", "BRL");
    const zero = Money.zero("BRL");

    expect(ten.isPositive()).toBe(true);
    expect(zero.isPositive()).toBe(false);
    expect(twenty.greaterThan(ten)).toBe(true);
    expect(ten.greaterThan(twenty)).toBe(false);
    expect(ten.greaterThanOrEqual(tenAgain)).toBe(true);
    expect(ten.lessThan(twenty)).toBe(true);
    expect(twenty.lessThan(ten)).toBe(false);
    expect(ten.lessThanOrEqual(tenAgain)).toBe(true);

    expect(() => ten.greaterThan(Money.create("5.00", "USD"))).toThrow(
      DomainError,
    );
  });

  test("rejects scientific notation, negatives, invalid currencies, and excessive precision", () => {
    for (const amount of ["1e2", "-1", "0.001", "abc", "10,50", ""]) {
      expect(() => Money.create(amount, "BRL")).toThrow(DomainError);
    }
    for (const currency of ["brl", "US", "USDT", "123", ""]) {
      expect(() => Money.create("10.00", currency)).toThrow(DomainError);
    }
  });
});
