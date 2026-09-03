export interface CreateOutboxMessageProps {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  attemptCount?: number;
  nextAttemptAt?: Date;
  leaseUntil?: Date;
  leaseToken?: string;
  publishedAt?: Date;
  createdAt?: Date;
}

/** @wiki docs/brain/entities/InboxOutbox.md */
export class OutboxMessage {
  private constructor(
    public readonly id: string,
    public readonly eventType: string,
    public readonly payload: Record<string, unknown>,
    public attemptCount: number,
    public nextAttemptAt: Date,
    public leaseUntil?: Date,
    public leaseToken?: string,
    public publishedAt?: Date,
    public readonly createdAt: Date = new Date(),
  ) {}

  public static create(props: CreateOutboxMessageProps): OutboxMessage {
    const now = props.createdAt ?? new Date();
    return new OutboxMessage(
      props.id,
      props.eventType,
      props.payload,
      props.attemptCount ?? 0,
      props.nextAttemptAt ?? now,
      props.leaseUntil,
      props.leaseToken,
      props.publishedAt,
      now,
    );
  }

  public isPublished(): boolean {
    return this.publishedAt !== undefined && this.publishedAt !== null;
  }

  public isLeaseExpired(now = new Date()): boolean {
    return Boolean(this.leaseUntil && this.leaseUntil < now);
  }

  public isEligible(now = new Date()): boolean {
    if (this.isPublished()) {
      return false;
    }
    if (this.nextAttemptAt > now) {
      return false;
    }
    return !this.leaseUntil || this.isLeaseExpired(now);
  }

  public claim(leaseUntil: Date, leaseToken: string): void {
    this.leaseUntil = leaseUntil;
    this.leaseToken = leaseToken;
  }

  public markPublished(publishedAt = new Date()): void {
    this.publishedAt = publishedAt;
    this.leaseUntil = undefined;
    this.leaseToken = undefined;
  }

  public recordAttempt(nextAttemptAt: Date): void {
    this.recordFailure(nextAttemptAt);
  }

  public recordFailure(nextAttemptAt: Date): void {
    this.attemptCount += 1;
    this.nextAttemptAt = nextAttemptAt;
    this.leaseUntil = undefined;
    this.leaseToken = undefined;
  }
}
