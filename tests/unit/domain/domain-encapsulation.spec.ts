import { describe, expect, test } from "bun:test";
import { DomainError } from "../../../src/domain/shared/domain-error";
import { Money } from "../../../src/domain/shared/money";
import { WagerTransaction } from "../../../src/domain/wagering/wager-transaction";
import { OutboxMessage } from "../../../src/domain/messaging/outbox-message";
import { InboxMessage } from "../../../src/domain/messaging/inbox-message";

describe("Domain Entity Encapsulation (Issue #18)", () => {
  describe("WagerTransaction Encapsulation", () => {
    test("markProcessed sets PROCESSED status, observedBalance, and updates timestamp", () => {
      const tx = WagerTransaction.create({
        id: "tx-1",
        status: "PENDING",
        kind: "BET",
      });
      const balance = Money.create("50.00", "BRL");

      tx.markProcessed(balance);

      expect(tx.status).toBe("PROCESSED");
      expect(tx.observedBalance).toBe(balance);
      expect(tx.isTerminal()).toBe(true);
    });

    test("markRejected sets REJECTED status, failureCode, observedBalance, and updates timestamp", () => {
      const tx = WagerTransaction.create({
        id: "tx-2",
        status: "PENDING",
        kind: "BET",
      });
      const balance = Money.create("100.00", "BRL");

      tx.markRejected("INSUFFICIENT_FUNDS", balance);

      expect(tx.status).toBe("REJECTED");
      expect(tx.failureCode).toBe("INSUFFICIENT_FUNDS");
      expect(tx.observedBalance).toBe(balance);
      expect(tx.isTerminal()).toBe(true);
    });

    test("markPendingReference transitions to PENDING_REFERENCE and sets next attempt", () => {
      const tx = WagerTransaction.create({
        id: "tx-3",
        status: "PENDING",
        kind: "REFUND",
      });
      const nextAttempt = new Date("2026-09-02T23:00:00Z");

      tx.markPendingReference(nextAttempt);

      expect(tx.status).toBe("PENDING_REFERENCE");
      expect(tx.nextReferenceAttemptAt).toEqual(nextAttempt);
      expect(tx.isTerminal()).toBe(false);
    });

    test("linkReference sets referenceTransactionId", () => {
      const tx = WagerTransaction.create({
        id: "tx-4",
        status: "PENDING",
        kind: "REFUND",
      });

      tx.linkReference("parent-tx-123");

      expect(tx.referenceTransactionId).toBe("parent-tx-123");
    });

    test("reference lease and retry scheduling transitions encapsulate state changes", () => {
      const tx = WagerTransaction.create({
        id: "tx-5",
        status: "PENDING_REFERENCE",
        referenceAttemptCount: 1,
        referenceLeaseUntil: new Date("2026-09-02T23:05:00Z"),
      });

      tx.clearReferenceLease();
      expect(tx.referenceLeaseUntil).toBeUndefined();

      const retryDate = new Date("2026-09-02T23:10:00Z");
      tx.scheduleReferenceRetry(retryDate);
      expect(tx.referenceAttemptCount).toBe(2);
      expect(tx.nextReferenceAttemptAt).toEqual(retryDate);
      expect(tx.referenceLeaseUntil).toBeUndefined();

      tx.clearReferenceAttempt();
      expect(tx.nextReferenceAttemptAt).toBeUndefined();
      expect(tx.referenceLeaseUntil).toBeUndefined();
    });

    test("throws DomainError on invalid transition from terminal states", () => {
      const balance = Money.create("100.00", "BRL");
      const processedTx = WagerTransaction.create({
        id: "tx-6",
        status: "PROCESSED",
      });

      expect(() => processedTx.markProcessed(balance)).toThrow(DomainError);
      expect(() => processedTx.markRejected("ANY_CODE", balance)).toThrow(DomainError);
      expect(() => processedTx.markPendingReference()).toThrow(DomainError);

      const rejectedTx = WagerTransaction.create({
        id: "tx-7",
        status: "REJECTED",
        failureCode: "INSUFFICIENT_FUNDS",
      });

      expect(() => rejectedTx.markProcessed(balance)).toThrow(DomainError);
    });
  });

  describe("OutboxMessage Encapsulation", () => {
    test("claim encapsulates leaseUntil and leaseToken", () => {
      const msg = OutboxMessage.create({
        id: "out-1",
        eventType: "WagerTransactionProcessed.v1",
        payload: { transactionId: "tx-1" },
      });

      const leaseUntil = new Date(Date.now() + 30_000);
      msg.claim(leaseUntil, "token-abc-123");

      expect(msg.leaseUntil).toEqual(leaseUntil);
      expect(msg.leaseToken).toBe("token-abc-123");
    });

    test("markPublished clears leases and marks publishedAt", () => {
      const msg = OutboxMessage.create({
        id: "out-2",
        eventType: "WagerTransactionProcessed.v1",
        payload: { transactionId: "tx-2" },
        leaseUntil: new Date(),
        leaseToken: "token-123",
      });

      const publishedAt = new Date();
      msg.markPublished(publishedAt);

      expect(msg.isPublished()).toBe(true);
      expect(msg.publishedAt).toEqual(publishedAt);
      expect(msg.leaseUntil).toBeUndefined();
      expect(msg.leaseToken).toBeUndefined();
    });

    test("recordFailure increments attemptCount, sets nextAttemptAt, and clears lease", () => {
      const msg = OutboxMessage.create({
        id: "out-3",
        eventType: "WagerTransactionProcessed.v1",
        payload: { transactionId: "tx-3" },
        attemptCount: 2,
        leaseUntil: new Date(),
        leaseToken: "token-123",
      });

      const nextAttempt = new Date(Date.now() + 5000);
      msg.recordFailure(nextAttempt);

      expect(msg.attemptCount).toBe(3);
      expect(msg.nextAttemptAt).toEqual(nextAttempt);
      expect(msg.leaseUntil).toBeUndefined();
      expect(msg.leaseToken).toBeUndefined();
    });

    test("isEligible correctly evaluates publication readiness and leases", () => {
      const now = new Date("2026-09-02T23:00:00Z");

      const eligibleMsg = OutboxMessage.create({
        id: "out-4",
        eventType: "Event.v1",
        payload: {},
        nextAttemptAt: new Date("2026-09-02T22:59:00Z"),
      });
      expect(eligibleMsg.isEligible(now)).toBe(true);

      const publishedMsg = OutboxMessage.create({
        id: "out-5",
        eventType: "Event.v1",
        payload: {},
        publishedAt: new Date("2026-09-02T22:50:00Z"),
      });
      expect(publishedMsg.isEligible(now)).toBe(false);

      const futureMsg = OutboxMessage.create({
        id: "out-6",
        eventType: "Event.v1",
        payload: {},
        nextAttemptAt: new Date("2026-09-02T23:05:00Z"),
      });
      expect(futureMsg.isEligible(now)).toBe(false);

      const leasedMsg = OutboxMessage.create({
        id: "out-7",
        eventType: "Event.v1",
        payload: {},
        nextAttemptAt: new Date("2026-09-02T22:50:00Z"),
        leaseUntil: new Date("2026-09-02T23:05:00Z"),
      });
      expect(leasedMsg.isEligible(now)).toBe(false);

      const expiredLeaseMsg = OutboxMessage.create({
        id: "out-8",
        eventType: "Event.v1",
        payload: {},
        nextAttemptAt: new Date("2026-09-02T22:50:00Z"),
        leaseUntil: new Date("2026-09-02T22:55:00Z"),
      });
      expect(expiredLeaseMsg.isEligible(now)).toBe(true);
    });
  });

  describe("InboxMessage Encapsulation", () => {
    test("encapsulates payload hash and recordProcessed", () => {
      const inbox = InboxMessage.create({
        id: "in-1",
        consumerName: "SqsWagerConsumer",
        messageId: "msg-123",
        payloadHash: "hash-xyz",
      });

      expect(inbox.hasSamePayload("hash-xyz")).toBe(true);
      expect(inbox.hasSamePayload("hash-different")).toBe(false);

      const now = new Date("2026-09-02T23:00:00Z");
      inbox.recordProcessed(now);
      expect(inbox.processedAt).toEqual(now);
    });
  });
});
