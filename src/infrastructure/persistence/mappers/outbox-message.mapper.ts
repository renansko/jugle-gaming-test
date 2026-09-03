import { OutboxMessage } from "../../../domain/messaging/outbox-message";
import type { OutboxMessageEntity } from "../entities/outbox-message.entity";

export function outboxMessageToDomain(
  entity: OutboxMessageEntity,
): OutboxMessage {
  return OutboxMessage.create({
    id: entity.id,
    eventType: entity.eventType,
    payload: entity.payload,
    attemptCount: entity.attemptCount,
    nextAttemptAt: entity.nextAttemptAt,
    leaseUntil: entity.leaseUntil,
    leaseToken: entity.leaseToken,
    publishedAt: entity.publishedAt,
    createdAt: entity.createdAt,
  });
}

export function outboxMessageToPersistence(
  domain: OutboxMessage,
  target?: OutboxMessageEntity,
): OutboxMessageEntity {
  const entity = (target ?? {}) as OutboxMessageEntity;

  entity.id = domain.id;
  entity.eventType = domain.eventType;
  entity.payload = domain.payload;
  entity.attemptCount = domain.attemptCount;
  entity.nextAttemptAt = domain.nextAttemptAt;
  entity.leaseUntil = domain.leaseUntil;
  entity.leaseToken = domain.leaseToken;
  entity.publishedAt = domain.publishedAt;
  entity.createdAt = domain.createdAt;

  return entity;
}
