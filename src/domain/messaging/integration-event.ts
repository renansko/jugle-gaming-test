import { randomUUID } from "node:crypto";

export type IntegrationEventEnvelope = {
  eventId: string;
  eventType: string;
  version: 1;
  aggregateId: string;
  correlationId: string;
  causationId?: string;
  occurredAt: string;
  data: Record<string, unknown>;
};

/** @wiki docs/brain/resources/IntegrationEvents.md */
export abstract class IntegrationEvent {
  protected constructor(public readonly envelope: IntegrationEventEnvelope) {}
}
export class WagerTransactionProcessed extends IntegrationEvent {
  public constructor(
    aggregateId: string,
    correlationId: string,
    data: Record<string, unknown>,
  ) {
    super({
      eventId: randomUUID(),
      eventType: "WagerTransactionProcessed",
      version: 1,
      aggregateId,
      correlationId,
      occurredAt: new Date().toISOString(),
      data,
    });
  }
}
export class WagerTransactionRejected extends IntegrationEvent {
  public constructor(
    aggregateId: string,
    correlationId: string,
    data: Record<string, unknown>,
  ) {
    super({
      eventId: randomUUID(),
      eventType: "WagerTransactionRejected",
      version: 1,
      aggregateId,
      correlationId,
      occurredAt: new Date().toISOString(),
      data,
    });
  }
}
export class WalletBalanceChanged extends IntegrationEvent {
  public constructor(
    aggregateId: string,
    correlationId: string,
    data: Record<string, unknown>,
  ) {
    super({
      eventId: randomUUID(),
      eventType: "WalletBalanceChanged",
      version: 1,
      aggregateId,
      correlationId,
      occurredAt: new Date().toISOString(),
      data,
    });
  }
}
export class WagerTransactionPendingReference extends IntegrationEvent {
  public constructor(
    aggregateId: string,
    correlationId: string,
    data: Record<string, unknown>,
  ) {
    super({
      eventId: randomUUID(),
      eventType: "WagerTransactionPendingReference",
      version: 1,
      aggregateId,
      correlationId,
      occurredAt: new Date().toISOString(),
      data,
    });
  }
}
