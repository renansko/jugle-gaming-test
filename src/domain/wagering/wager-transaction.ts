import { DomainError } from "../shared/domain-error";
import type { Money } from "../shared/money";

export type WagerTransactionStatus =
  | "PENDING"
  | "PENDING_REFERENCE"
  | "PROCESSED"
  | "REJECTED"
  | "FAILED";

export type WagerTransactionKind =
  | "BET"
  | "WIN"
  | "LOSS"
  | "REFUND"
  | "ROLLBACK"
  | "OPENING";


export interface CreateWagerTransactionProps {
  id?: string;
  idempotencyKey?: string;
  providerId?: string;
  externalTransactionId?: string;
  payloadHash?: string;
  kind?: WagerTransactionKind;
  walletId?: string;
  playerId?: string;
  money?: Money;
  roundId?: string;
  gameId?: string;
  referenceExternalTransactionId?: string;
  referenceTransactionId?: string;
  status?: WagerTransactionStatus;
  failureCode?: string;
  observedBalance?: Money;
  createdAt?: Date;
  updatedAt?: Date;
}

/** @wiki docs/brain/entities/WagerTransaction.md */
export class WagerTransaction {
  public id?: string;
  public idempotencyKey?: string;
  public providerId?: string;
  public externalTransactionId?: string;
  public payloadHash?: string;
  public kind?: WagerTransactionKind;
  public walletId?: string;
  public playerId?: string;
  public money?: Money;
  public roundId?: string;
  public gameId?: string;
  public referenceExternalTransactionId?: string;
  public referenceTransactionId?: string;
  public status: WagerTransactionStatus;
  public failureCode?: string;
  public observedBalance?: Money;
  public createdAt?: Date;
  public updatedAt?: Date;

  private constructor(props: CreateWagerTransactionProps = {}) {
    this.id = props.id;
    this.idempotencyKey = props.idempotencyKey;
    this.providerId = props.providerId;
    this.externalTransactionId = props.externalTransactionId;
    this.payloadHash = props.payloadHash;
    this.kind = props.kind;
    this.walletId = props.walletId;
    this.playerId = props.playerId;
    this.money = props.money;
    this.roundId = props.roundId;
    this.gameId = props.gameId;
    this.referenceExternalTransactionId = props.referenceExternalTransactionId;
    this.referenceTransactionId = props.referenceTransactionId;
    this.status = props.status ?? "PENDING";
    this.failureCode = props.failureCode;
    this.observedBalance = props.observedBalance;
    this.createdAt = props.createdAt ?? new Date();
    this.updatedAt = props.updatedAt ?? new Date();
  }

  public static create(
    props?: CreateWagerTransactionProps,
  ): WagerTransaction {
    return new WagerTransaction(props);
  }

  public static rehydrate(
    statusOrProps: WagerTransactionStatus | CreateWagerTransactionProps,
    failureCode?: string,
  ): WagerTransaction {
    if (typeof statusOrProps === "string") {
      return new WagerTransaction({
        status: statusOrProps,
        failureCode,
      });
    }
    return new WagerTransaction(statusOrProps);
  }


  public pendingReference(): void {
    this.transition("PENDING_REFERENCE");
  }

  public processed(): void {
    this.transition("PROCESSED");
  }

  public rejected(failureCode: string): void {
    this.failureCode = failureCode;
    this.transition("REJECTED");
  }

  public failed(failureCode: string): void {
    this.failureCode = failureCode;
    this.transition("FAILED");
  }

  public isTerminal(): boolean {
    return ["PROCESSED", "REJECTED", "FAILED"].includes(this.status);
  }

  private transition(nextStatus: WagerTransactionStatus): void {
    if (this.isTerminal()) {
      throw new DomainError(
        "INVALID_TRANSACTION_TRANSITION",
        "Terminal transactions cannot transition",
      );
    }
    this.status = nextStatus;
  }
}
