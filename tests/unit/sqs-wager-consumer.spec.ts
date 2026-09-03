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

test("keeps transient failures unacknowledged and applies visibility backoff when below max receive count", async () => {
  const sentCommands: unknown[] = [];
  const fakeSqsClient = {
    send: mock(async (command: unknown) => {
      sentCommands.push(command);
      return {};
    }),
    destroy: () => undefined,
  };
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
      sqsMaxReceiveCount: 5,
    } as never,
    {} as never,
    metrics as never,
  );
  const internalConsumer = consumer as never as {
    client: typeof fakeSqsClient;
    handleProcessingError(
      error: unknown,
      body: string,
      receiptHandle?: string,
      attributes?: Record<string, string>,
    ): Promise<void>;
    toDlq: ReturnType<typeof mock>;
  };
  internalConsumer.client = fakeSqsClient;
  internalConsumer.toDlq = mock(async () => undefined);

  await internalConsumer.handleProcessingError(
    new DomainError("DEPENDENCY_UNAVAILABLE", "PostgreSQL unavailable"),
    "{}",
    "receipt-handle-1",
    { ApproximateReceiveCount: "2" },
  );

  expect(internalConsumer.toDlq).not.toHaveBeenCalled();
  expect(metrics.increment).toHaveBeenCalledWith("sqs_retries_total", {
    status: "transient",
  });
  expect(fakeSqsClient.send).toHaveBeenCalled();
  const visibilityCommand = sentCommands[0] as {
    input?: { QueueUrl: string; ReceiptHandle: string; VisibilityTimeout: number };
  };
  expect(visibilityCommand?.input?.ReceiptHandle).toBe("receipt-handle-1");
  expect(visibilityCommand?.input?.VisibilityTimeout).toBeGreaterThan(0);
});

test("routes transient failure to DLQ when receive count reaches or exceeds max receive count", async () => {
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
      sqsMaxReceiveCount: 3,
    } as never,
    {} as never,
    metrics as never,
  );
  const internalConsumer = consumer as never as {
    handleProcessingError(
      error: unknown,
      body: string,
      receiptHandle?: string,
      attributes?: Record<string, string>,
    ): Promise<void>;
    toDlq: ReturnType<typeof mock>;
  };
  internalConsumer.toDlq = mock(async () => undefined);

  await internalConsumer.handleProcessingError(
    new Error("connection reset by peer"),
    '{"messageId":"msg-exhausted"}',
    "receipt-handle-exhausted",
    { ApproximateReceiveCount: "3" },
  );

  expect(internalConsumer.toDlq).toHaveBeenCalledWith(
    '{"messageId":"msg-exhausted"}',
    "receipt-handle-exhausted",
    "max_retries_exceeded",
  );
  expect(metrics.increment).toHaveBeenCalledWith("sqs_retries_total", {
    status: "exhausted",
  });
});

test("routes permanent domain error directly to DLQ without retrying", async () => {
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
      sqsMaxReceiveCount: 5,
    } as never,
    {} as never,
    metrics as never,
  );
  const internalConsumer = consumer as never as {
    handleProcessingError(
      error: unknown,
      body: string,
      receiptHandle?: string,
      attributes?: Record<string, string>,
    ): Promise<void>;
    toDlq: ReturnType<typeof mock>;
  };
  internalConsumer.toDlq = mock(async () => undefined);

  await internalConsumer.handleProcessingError(
    new DomainError("WALLET_NOT_FOUND", "Wallet does not exist"),
    '{"walletId":"not-found"}',
    "receipt-permanent",
    { ApproximateReceiveCount: "1" },
  );

  expect(internalConsumer.toDlq).toHaveBeenCalledWith(
    '{"walletId":"not-found"}',
    "receipt-permanent",
    "permanent_failure",
  );
});

test("routes malformed JSON directly to DLQ as invalid_payload", async () => {
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
      sqsMaxReceiveCount: 5,
    } as never,
    {} as never,
    metrics as never,
  );
  const internalConsumer = consumer as never as {
    consume(
      body: string,
      receiptHandle?: string,
      attributes?: Record<string, string>,
    ): Promise<void>;
    toDlq: ReturnType<typeof mock>;
  };
  internalConsumer.toDlq = mock(async () => undefined);

  await internalConsumer.consume("not-valid-json", "receipt-malformed");

  expect(internalConsumer.toDlq).toHaveBeenCalledWith(
    "not-valid-json",
    "receipt-malformed",
    "invalid_payload",
  );
});
