import type { InboxMessage } from "../../domain/messaging/inbox-message";

export interface InboxRepositoryPort {
  findByConsumerAndMessageId(
    consumerName: string,
    messageId: string,
  ): Promise<InboxMessage | null>;
  save(message: InboxMessage): Promise<void>;
}

export const INBOX_REPOSITORY_PORT = Symbol("INBOX_REPOSITORY_PORT");
