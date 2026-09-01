import { DomainError } from "../shared/domain-error";

export type WagerTransactionStatus = "PENDING" | "PENDING_REFERENCE" | "PROCESSED" | "REJECTED" | "FAILED";

/** @wiki docs/brain/entities/WagerTransaction.md */
export class WagerTransaction {
  private constructor(public status: WagerTransactionStatus, public failureCode?: string) {}

  public static create(): WagerTransaction { return new WagerTransaction("PENDING"); }
  public static rehydrate(status: WagerTransactionStatus, failureCode?: string): WagerTransaction { return new WagerTransaction(status, failureCode); }
  public pendingReference(): void { this.transition("PENDING_REFERENCE"); }
  public processed(): void { this.transition("PROCESSED"); }
  public rejected(code: string): void { this.failureCode = code; this.transition("REJECTED"); }
  public failed(code: string): void { this.failureCode = code; this.transition("FAILED"); }
  public isTerminal(): boolean { return ["PROCESSED", "REJECTED", "FAILED"].includes(this.status); }
  private transition(next: WagerTransactionStatus): void {
    if (this.isTerminal()) throw new DomainError("INVALID_TRANSACTION_TRANSITION", "Terminal transactions cannot transition");
    this.status = next;
  }
}
