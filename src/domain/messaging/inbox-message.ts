export interface CreateInboxMessageProps {
  id: string;
  consumerName: string;
  messageId: string;
  payloadHash: string;
  processedAt?: Date;
}

/** @wiki docs/brain/entities/InboxOutbox.md */
export class InboxMessage {
  private constructor(
    public readonly id: string,
    public readonly consumerName: string,
    public readonly messageId: string,
    public readonly payloadHash: string,
    public processedAt: Date,
  ) {}

  public static create(props: CreateInboxMessageProps): InboxMessage {
    return new InboxMessage(
      props.id,
      props.consumerName,
      props.messageId,
      props.payloadHash,
      props.processedAt ?? new Date(),
    );
  }

  public recordProcessed(processedAt = new Date()): void {
    this.processedAt = processedAt;
  }

  public hasSamePayload(hash: string): boolean {
    return this.payloadHash === hash;
  }
}
