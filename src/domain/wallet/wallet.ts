import { DomainError } from "../shared/domain-error";
import { Money } from "../shared/money";
import { type LedgerDirection, WalletLedgerEntry } from "./wallet-ledger-entry";

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

  public static open(input: { id: string; playerId: string; currency: string; initialBalance?: Money; now?: Date }): Wallet {
    const balance = input.initialBalance ?? Money.zero(input.currency);
    if (balance.currency !== input.currency) throw new DomainError("CURRENCY_MISMATCH", "Initial balance currency differs from wallet");
    const now = input.now ?? new Date();
    return new Wallet(input.id, input.playerId, input.currency, balance, 1, now, now);
  }

  public static rehydrate(input: { id: string; playerId: string; currency: string; balance: Money; version: number; createdAt: Date; updatedAt: Date }): Wallet {
    if (input.balance.currency !== input.currency || input.version < 1) throw new DomainError("INVALID_WALLET", "Invalid persisted wallet");
    return new Wallet(input.id, input.playerId, input.currency, input.balance, input.version, input.createdAt, input.updatedAt);
  }

  public credit(amount: Money, transactionId: string, entryId: string, now = new Date()): WalletLedgerEntry {
    return this.change("CREDIT", amount, transactionId, entryId, now);
  }

  public debit(amount: Money, transactionId: string, entryId: string, now = new Date()): WalletLedgerEntry {
    return this.change("DEBIT", amount, transactionId, entryId, now);
  }

  private change(direction: LedgerDirection, amount: Money, transactionId: string, entryId: string, now: Date): WalletLedgerEntry {
    if (amount.currency !== this.currency) throw new DomainError("CURRENCY_MISMATCH", "Operation currency differs from wallet");
    if (amount.isZero()) throw new DomainError("INVALID_MONEY", "Wallet movements must be positive");
    const before = this.balance;
    const after = direction === "CREDIT" ? before.add(amount) : before.subtract(amount);
    const entry = WalletLedgerEntry.create({ id: entryId, walletId: this.id, transactionId, direction, money: amount, balanceBefore: before, balanceAfter: after, createdAt: now });
    this.balance = after;
    this.version += 1;
    this.updatedAt = now;
    return entry;
  }
}
