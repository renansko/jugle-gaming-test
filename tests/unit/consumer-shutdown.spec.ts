import { describe, expect, mock, test } from "bun:test";
import { SqsWagerConsumer } from "../../src/infrastructure/messaging/sqs-wager-consumer";

describe("SqsWagerConsumer shutdown & recovery", () => {
  const baseConfig = {
    awsRegion: "us-east-1",
    awsAccessKeyId: "test",
    awsSecretAccessKey: "test",
    sqsEndpoint: "http://localhost:4566",
    wagerQueueUrl: "http://localhost:4566/000000000000/wager-transactions.fifo",
    wagerDlqUrl: "http://localhost:4566/000000000000/wager-transactions-dlq.fifo",
    shutdownGracePeriodMs: 500,
  };

  const samplePayload = JSON.stringify({
    messageId: "msg-shutdown-1",
    type: "WagerTransactionRequested",
    occurredAt: "2026-09-02T12:00:00.000Z",
    data: {
      idempotencyKey: "idem-shutdown-1",
      providerId: "provider-test",
      externalTransactionId: "ext-shutdown-1",
      walletId: "00000000-0000-4000-8000-000000000001",
      playerId: "player-test",
      currency: "BRL",
      amount: "10.00",
      kind: "BET",
      roundId: "round-shutdown-1",
    },
  });

  test("completes drain cleanly when in-flight messages finish within the grace period", async () => {
    const metrics = {
      observe: mock(() => undefined),
      increment: mock(() => undefined),
    };
    let resolveExecute: () => void = () => {};
    const executePromise = new Promise<{
      id: string;
      status: "PROCESSED";
      balance: { amount: string; currency: string };
      idempotentReplay: boolean;
    }>((resolve) => {
      resolveExecute = () =>
        resolve({
          id: "tx-1",
          status: "PROCESSED",
          balance: { amount: "90.00", currency: "BRL" },
          idempotentReplay: false,
        });
    });

    const wagering = {
      execute: mock(async () => executePromise),
    };

    const consumer = new SqsWagerConsumer(
      baseConfig as never,
      wagering as never,
      metrics as never,
    );

    const internalClient = (consumer as unknown as { client: { send: ReturnType<typeof mock>; destroy: ReturnType<typeof mock> } }).client;
    internalClient.send = mock(async () => ({}));
    internalClient.destroy = mock(() => undefined);

    // Start consuming a message (in-flight)
    const consumePromise = (
      consumer as unknown as {
        consume: (body: string, receiptHandle?: string, attributes?: Record<string, string>) => Promise<void>;
      }
    ).consume(samplePayload, "receipt-handle-1", {
      ApproximateReceiveCount: "1",
      SentTimestamp: String(Date.now()),
    });

    // Initiate shutdown with 200ms grace period
    const shutdownPromise = consumer.shutdown(200);

    // Let the message finish processing in 30ms (well within the 200ms grace period)
    await new Promise((r) => setTimeout(r, 30));
    resolveExecute();

    await Promise.all([consumePromise, shutdownPromise]);

    // Metric consumer_drain_total should be incremented
    expect(metrics.increment).toHaveBeenCalledWith("consumer_drain_total");
    // Message should be deleted
    expect(internalClient.send).toHaveBeenCalled();
    // Client should be destroyed after drain
    expect(internalClient.destroy).toHaveBeenCalled();
  });

  test("releases visibility to 0 when in-flight message exceeds the grace period", async () => {
    const metrics = {
      observe: mock(() => undefined),
      increment: mock(() => undefined),
    };

    // Simulated hung/slow transaction
    const wagering = {
      execute: mock(
        () => new Promise((resolve) => setTimeout(resolve, 5000)),
      ),
    };

    const consumer = new SqsWagerConsumer(
      baseConfig as never,
      wagering as never,
      metrics as never,
    );

    const internalClient = (consumer as unknown as { client: { send: ReturnType<typeof mock>; destroy: ReturnType<typeof mock> } }).client;
    const sentCommands: unknown[] = [];
    internalClient.send = mock(async (cmd: unknown) => {
      sentCommands.push(cmd);
      return {};
    });
    internalClient.destroy = mock(() => undefined);

    // Start consuming message
    void (
      consumer as unknown as {
        consume: (body: string, receiptHandle?: string, attributes?: Record<string, string>) => Promise<void>;
      }
    ).consume(samplePayload, "receipt-handle-hung", {
      ApproximateReceiveCount: "1",
      SentTimestamp: String(Date.now()),
    });

    // Wait 20ms for message to enter in-flight
    await new Promise((r) => setTimeout(r, 20));

    // Shutdown with short grace period of 80ms
    await consumer.shutdown(80);

    // Metrics should record visibility release and shutdown failure/timeout
    expect(metrics.increment).toHaveBeenCalledWith(
      "consumer_visibility_released_total",
    );
    expect(metrics.increment).toHaveBeenCalledWith("shutdown_failures_total");

    // Client should send ChangeMessageVisibility with VisibilityTimeout: 0
    const visibilityReleaseCmd = sentCommands.find((cmd) => {
      const c = cmd as { input?: { VisibilityTimeout?: number; ReceiptHandle?: string } };
      return (
        c.input?.VisibilityTimeout === 0 &&
        c.input?.ReceiptHandle === "receipt-handle-hung"
      );
    });
    expect(visibilityReleaseCmd).toBeDefined();
    expect(internalClient.destroy).toHaveBeenCalled();
  });

  test("records redelivery metric and log when message has receiveCount > 1", async () => {
    const metrics = {
      observe: mock(() => undefined),
      increment: mock(() => undefined),
    };

    const wagering = {
      execute: mock(async () => ({
        id: "tx-2",
        status: "PROCESSED" as const,
        balance: { amount: "80.00", currency: "BRL" },
        idempotentReplay: false,
      })),
    };

    const consumer = new SqsWagerConsumer(
      baseConfig as never,
      wagering as never,
      metrics as never,
    );

    const internalClient = (consumer as unknown as { client: { send: ReturnType<typeof mock> } }).client;
    internalClient.send = mock(async () => ({}));

    await (
      consumer as unknown as {
        consume: (body: string, receiptHandle?: string, attributes?: Record<string, string>) => Promise<void>;
      }
    ).consume(samplePayload, "receipt-redelivered", {
      ApproximateReceiveCount: "2",
      SentTimestamp: String(Date.now()),
    });

    expect(metrics.increment).toHaveBeenCalledWith("sqs_redeliveries_total");
  });

  test("triggers onAfterCommitBeforeAck hook before deleting message", async () => {
    const metrics = {
      observe: mock(() => undefined),
      increment: mock(() => undefined),
    };

    const wagering = {
      execute: mock(async () => ({
        id: "tx-3",
        status: "PROCESSED" as const,
        balance: { amount: "70.00", currency: "BRL" },
        idempotentReplay: false,
      })),
    };

    const consumer = new SqsWagerConsumer(
      baseConfig as never,
      wagering as never,
      metrics as never,
    );

    const internalClient = (consumer as unknown as { client: { send: ReturnType<typeof mock> } }).client;
    internalClient.send = mock(async () => ({}));

    let hookCalled = false;
    consumer.onAfterCommitBeforeAck = mock(async () => {
      hookCalled = true;
      // Throwing here simulates interruption/crash after commit and before delete
      throw new Error("Consumer crashed after commit!");
    });

    try {
      await (
        consumer as unknown as {
          consume: (body: string, receiptHandle?: string, attributes?: Record<string, string>) => Promise<void>;
        }
      ).consume(samplePayload, "receipt-crash", {
        ApproximateReceiveCount: "1",
        SentTimestamp: String(Date.now()),
      });
    } catch {
      // Expected
    }

    expect(hookCalled).toBe(true);
    // DeleteMessage should NOT have been called
    const deleteCmd = (internalClient.send as ReturnType<typeof mock>).mock.calls.find(
      (call: unknown[]) => {
        const cmd = call[0] as { constructor: { name: string } };
        return cmd?.constructor?.name === "DeleteMessageCommand";
      },
    );
    expect(deleteCmd).toBeUndefined();
  });
});
