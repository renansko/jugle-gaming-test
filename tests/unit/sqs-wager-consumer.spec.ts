import { expect, mock, test } from "bun:test";
import { canonicalWagerPayloadHash } from "../../src/application/wagering/canonical-payload";
import { DomainError } from "../../src/domain/shared/domain-error";
import { SqsWagerConsumer } from "../../src/infrastructure/messaging/sqs-wager-consumer";

test("uses only business data for the inbox payload hash", async () => {
  const wagering = {
    execute: mock(async () => ({
      id: "transaction-id",
      status: "PROCESSED",
      balance: { amount: "90.00", currency: "BRL" },
      idempotentReplay: false,
    })),
  };
  const metrics = {
    observe: mock(() => undefined),
    increment: mock(() => undefined),
  };
  const config = {
    awsRegion: "us-east-1",
    awsAccessKeyId: "test",
    awsSecretAccessKey: "test",
    sqsEndpoint: "http://localhost:4566",
    wagerQueueUrl: "http://localhost:4566/queue",
    wagerDlqUrl: "http://localhost:4566/dlq",
  };
  const consumer = new SqsWagerConsumer(
    config as never,
    wagering as never,
    metrics as never,
  );
  const data = {
    idempotencyKey: "idem-1",
    providerId: "provider-1",
    externalTransactionId: "external-1",
    walletId: "00000000-0000-4000-8000-000000000001",
    playerId: "player-1",
    currency: "BRL",
    amount: "10.00",
    kind: "BET" as const,
    roundId: "round-1",
  };

  await (
    consumer as never as { consume: (body: string) => Promise<void> }
  ).consume(
    JSON.stringify({
      messageId: "message-1",
      type: "WagerTransactionRequested",
      occurredAt: "2026-09-01T12:00:00.000Z",
      data,
    }),
  );

  expect(wagering.execute).toHaveBeenCalledWith(
    data,
    expect.objectContaining({
      inbox: expect.objectContaining({
        payloadHash: canonicalWagerPayloadHash(data),
      }),
    }),
  );
});

test("keeps transient failures unacknowledged for SQS redelivery", async () => {
  const metrics = {
    observe: mock(() => undefined),
    increment: mock(() => undefined),
  };
  const consumer = new SqsWagerConsumer(
    {
      awsRegion: "us-east-1",
      awsAccessKeyId: "test",
      awsSecretAccessKey: "test",
      sqsEndpoint: "http://localhost:4566",
      wagerQueueUrl: "http://localhost:4566/queue",
      wagerDlqUrl: "http://localhost:4566/dlq",
    } as never,
    {} as never,
    metrics as never,
  );
  const internalConsumer = consumer as never as {
    handleProcessingError(
      error: unknown,
      body: string,
      receiptHandle?: string,
    ): Promise<void>;
    toDlq: ReturnType<typeof mock>;
  };
  internalConsumer.toDlq = mock(async () => undefined);

  await internalConsumer.handleProcessingError(
    new DomainError("DEPENDENCY_UNAVAILABLE", "PostgreSQL unavailable"),
    "{}",
    "receipt-handle",
  );

  expect(internalConsumer.toDlq).not.toHaveBeenCalled();
  expect(metrics.increment).toHaveBeenCalledWith("sqs_retries_total", {
    status: "transient",
  });
});
