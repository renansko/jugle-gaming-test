import { DomainError } from "../shared/domain-error";
import type { Money } from "../shared/money";

export type LedgerDirection = "CREDIT" | "DEBIT";

export interface CreateLedgerEntryProps {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt?: Date;
}

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

  public static create(props: CreateLedgerEntryProps): WalletLedgerEntry {
    const expectedBalance =
      props.direction === "CREDIT"
        ? props.balanceBefore.add(props.money)
        : props.balanceBefore.subtract(props.money);

    if (!expectedBalance.equals(props.balanceAfter)) {
      throw new DomainError(
        "INVALID_LEDGER_ENTRY",
        "Ledger balances do not reconcile",
      );
    }

    return new WalletLedgerEntry(
      props.id,
      props.walletId,
      props.transactionId,
      props.direction,
      props.money,
      props.balanceBefore,
      props.balanceAfter,
      props.createdAt ?? new Date(),
    );
  }
}
