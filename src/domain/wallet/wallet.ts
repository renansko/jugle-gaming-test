import { DomainError } from "../shared/domain-error";
import { Money } from "../shared/money";
import { type LedgerDirection, WalletLedgerEntry } from "./wallet-ledger-entry";

export interface OpenWalletProps {
  id: string;
  playerId: string;
  currency: string;
  initialBalance?: Money;
  now?: Date;
}

export interface RehydrateWalletProps {
  id: string;
  playerId: string;
  currency: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** @wiki docs/brain/entities/Wallet.md */
export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    public balance: Money,
    public version: number,
    public readonly createdAt: Date,
    public updatedAt: Date,
  ) {}

  public static open(props: OpenWalletProps): Wallet {
    const initialBalance = props.initialBalance ?? Money.zero(props.currency);

    if (initialBalance.currency !== props.currency) {
      throw new DomainError(
        "CURRENCY_MISMATCH",
        "Initial balance currency differs from wallet",
      );
    }

    const timestamp = props.now ?? new Date();
    return new Wallet(
      props.id,
      props.playerId,
      props.currency,
      initialBalance,
      1,
      timestamp,
      timestamp,
    );
  }

  public static rehydrate(state: RehydrateWalletProps): Wallet {
    if (state.balance.currency !== state.currency || state.version < 1) {
      throw new DomainError("INVALID_WALLET", "Invalid persisted wallet");
    }

    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      state.balance,
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  public credit(
    amount: Money,
    transactionId: string,
    entryId: string,
    now = new Date(),
  ): WalletLedgerEntry {
    return this.applyMovement("CREDIT", amount, transactionId, entryId, now);
  }

  public debit(
    amount: Money,
    transactionId: string,
    entryId: string,
    now = new Date(),
  ): WalletLedgerEntry {
    return this.applyMovement("DEBIT", amount, transactionId, entryId, now);
  }

  private applyMovement(
    direction: LedgerDirection,
    amount: Money,
    transactionId: string,
    entryId: string,
    now: Date,
  ): WalletLedgerEntry {
    if (amount.currency !== this.currency) {
      throw new DomainError(
        "CURRENCY_MISMATCH",
        "Operation currency differs from wallet",
      );
    }

    if (amount.isZero()) {
      throw new DomainError(
        "INVALID_MONEY",
        "Wallet movements must be positive",
      );
    }

    const currentBalance = this.balance;
    const nextBalance =
      direction === "CREDIT"
        ? currentBalance.add(amount)
        : currentBalance.subtract(amount);

    const ledgerEntry = WalletLedgerEntry.create({
      id: entryId,
      walletId: this.id,
      transactionId,
      direction,
      money: amount,
      balanceBefore: currentBalance,
      balanceAfter: nextBalance,
      createdAt: now,
    });

    this.balance = nextBalance;
    this.version += 1;
    this.updatedAt = now;

    return ledgerEntry;
  }
}
