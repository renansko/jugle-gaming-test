import { InboxMessage } from "../../../domain/messaging/inbox-message";
import type { InboxMessageEntity } from "../entities/inbox-message.entity";

export function inboxMessageToDomain(entity: InboxMessageEntity): InboxMessage {
  return InboxMessage.create({
    id: entity.id,
    consumerName: entity.consumerName,
    messageId: entity.messageId,
    payloadHash: entity.payloadHash,
    processedAt: entity.processedAt,
  });
}

export function inboxMessageToPersistence(
  domain: InboxMessage,
  target?: InboxMessageEntity,
): InboxMessageEntity {
  const entity = (target ?? {}) as InboxMessageEntity;

  entity.id = domain.id;
  entity.consumerName = domain.consumerName;
  entity.messageId = domain.messageId;
  entity.payloadHash = domain.payloadHash;
  entity.processedAt = domain.processedAt;

  return entity;
}
