import type { OutboxMessage } from "../../domain/messaging/outbox-message";

export interface OutboxRepositoryPort {
  save(message: OutboxMessage): Promise<void>;
  saveAll(messages: OutboxMessage[]): Promise<void>;
}

export const OUTBOX_REPOSITORY_PORT = Symbol("OUTBOX_REPOSITORY_PORT");
