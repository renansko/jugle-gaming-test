import { DomainError } from "../shared/domain-error";
import type { Money } from "../shared/money";

export type LedgerDirection = "CREDIT" | "DEBIT";

/** @wiki docs/brain/entities/WalletLedgerEntry.md */
export class WalletLedgerEntry {
  private constructor(
    public readonly id: string,
    public readonly walletId: string,
    public readonly transactionId: string,
    public readonly direction: LedgerDirection,
    public readonly money: Money,
    public readonly balanceBefore: Money,
    public readonly balanceAfter: Money,
    public readonly createdAt: Date,
  ) {}

  public static create(input: {
    id: string; walletId: string; transactionId: string; direction: LedgerDirection; money: Money;
    balanceBefore: Money; balanceAfter: Money; createdAt?: Date;
  }): WalletLedgerEntry {
    const expected = input.direction === "CREDIT"
      ? input.balanceBefore.add(input.money)
      : input.balanceBefore.subtract(input.money);
    if (!expected.equals(input.balanceAfter)) {
      throw new DomainError("INVALID_LEDGER_ENTRY", "Ledger balances do not reconcile");
    }
    return new WalletLedgerEntry(
      input.id, input.walletId, input.transactionId, input.direction, input.money,
      input.balanceBefore, input.balanceAfter, input.createdAt ?? new Date(),
    );
  }
}
