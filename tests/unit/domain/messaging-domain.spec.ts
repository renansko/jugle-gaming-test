import { describe, expect, test } from "bun:test";
import { InboxMessage } from "../../../src/domain/messaging/inbox-message";
import { OutboxMessage } from "../../../src/domain/messaging/outbox-message";

describe("Messaging Domain Entities", () => {
  test("InboxMessage encapsulates consumer, message ID, payload hash and processed timestamp", () => {
    const inbox = InboxMessage.create({
      id: "inbox-1",
      consumerName: "sqs-wager-consumer",
      messageId: "msg-123",
      payloadHash: "hash-abc",
    });

    expect(inbox.id).toBe("inbox-1");
    expect(inbox.consumerName).toBe("sqs-wager-consumer");
    expect(inbox.messageId).toBe("msg-123");
    expect(inbox.payloadHash).toBe("hash-abc");
    expect(inbox.hasSamePayload("hash-abc")).toBe(true);
    expect(inbox.hasSamePayload("hash-xyz")).toBe(false);
  });

  test("OutboxMessage encapsulates event type, payload, attempts, retry scheduling and published state", () => {
    const outbox = OutboxMessage.create({
      id: "outbox-1",
      eventType: "WagerTransactionProcessed",
      payload: { transactionId: "tx-1", status: "PROCESSED" },
    });

    expect(outbox.id).toBe("outbox-1");
    expect(outbox.eventType).toBe("WagerTransactionProcessed");
    expect(outbox.attemptCount).toBe(0);
    expect(outbox.isPublished()).toBe(false);

    outbox.recordAttempt(new Date(Date.now() + 5000));
    expect(outbox.attemptCount).toBe(1);

    outbox.markPublished();
    expect(outbox.isPublished()).toBe(true);
  });
});
