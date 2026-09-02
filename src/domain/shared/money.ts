import Decimal from "decimal.js";
import { DomainError } from "./domain-error";

/** @wiki docs/brain/entities/Money.md */
export class Money {
  private static readonly amountPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

  private constructor(
    public readonly amount: string,
    public readonly currency: string,
  ) {}

  public static create(amount: string, currency: string): Money {
    if (!Money.amountPattern.test(amount)) {
      throw new DomainError(
        "INVALID_MONEY",
        "Amount must be a non-negative decimal with at most two places",
      );
    }

    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new DomainError(
        "INVALID_MONEY",
        "Currency must be an uppercase ISO-4217 code",
      );
    }

    const normalizedAmount = new Decimal(amount).toFixed(2);
    return new Money(normalizedAmount, currency);
  }

  public static zero(currency: string): Money {
    return Money.create("0", currency);
  }

  public isZero(): boolean {
    return new Decimal(this.amount).isZero();
  }

  public isPositive(): boolean {
    return new Decimal(this.amount).isPositive() && !this.isZero();
  }

  public add(other: Money): Money {
    this.assertSameCurrency(other);
    const sum = new Decimal(this.amount).plus(other.amount).toFixed(2);
    return Money.create(sum, this.currency);
  }

  public subtract(other: Money): Money {
    this.assertSameCurrency(other);
    const difference = new Decimal(this.amount).minus(other.amount);

    if (difference.isNegative()) {
      throw new DomainError(
        "INSUFFICIENT_FUNDS",
        "Resulting amount cannot be negative",
      );
    }

    return Money.create(difference.toFixed(2), this.currency);
  }

  public greaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return new Decimal(this.amount).greaterThan(other.amount);
  }

  public greaterThanOrEqual(other: Money): boolean {
    this.assertSameCurrency(other);
    return new Decimal(this.amount).greaterThanOrEqualTo(other.amount);
  }

  public lessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return new Decimal(this.amount).lessThan(other.amount);
  }

  public lessThanOrEqual(other: Money): boolean {
    this.assertSameCurrency(other);
    return new Decimal(this.amount).lessThanOrEqualTo(other.amount);
  }

  public equals(other: Money): boolean {
    return this.currency === other.currency && this.amount === other.amount;
  }


  public toJSON(): { amount: string; currency: string } {
    return {
      amount: this.amount,
      currency: this.currency,
    };
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new DomainError("CURRENCY_MISMATCH", "Currencies must match");
    }
  }
}
