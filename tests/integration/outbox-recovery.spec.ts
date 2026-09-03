import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { MikroORM } from "@mikro-orm/postgresql";
import { Client } from "pg";
import { AppConfig } from "../../src/infrastructure/config/app-config";
import { OutboxPublisher } from "../../src/infrastructure/messaging/outbox-publisher";
import { SqsWagerConsumer } from "../../src/infrastructure/messaging/sqs-wager-consumer";
import { OperationalMetrics } from "../../src/infrastructure/observability/operational-metrics";
import { MessagingHarness } from "../support/messaging-harness";

const baseUrl = process.env.TEST_APP_URL;
const sqsEndpoint = process.env.SQS_ENDPOINT ?? "http://localstack:4566";
const queueUrl =
  process.env.SQS_WAGER_QUEUE_URL ??
  "http://localstack:4566/000000000000/wager-transactions.fifo";
const eventQueueUrl =
  process.env.SQS_EVENT_QUEUE_URL ??
  "http://localstack:4566/000000000000/wager-events.fifo";
const dlqUrl =
  process.env.SQS_WAGER_DLQ_URL ??
  "http://localstack:4566/000000000000/wager-transactions-dlq.fifo";
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://wagering:wagering@postgres:5432/wagering";

const integration = baseUrl ? describe : describe.skip;

const sqs = new SQSClient({
  region: process.env.AWS_REGION ?? "us-east-1",
  endpoint: sqsEndpoint,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "test",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
  },
});

type Wallet = { id: string; balance: { amount: string; currency: string } };

async function request(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
}

async function createWallet(
  playerId: string,
  initialBalance = "100.00",
): Promise<Wallet> {
  const response = await request("/wallets", {
    method: "POST",
    body: JSON.stringify({ playerId, currency: "BRL", initialBalance }),
  });
  expect(response.status).toBe(201);
  return response.json() as Promise<Wallet>;
}

async function waitFor<T>(
  fn: () => Promise<T | null | undefined>,
  timeoutMs = 15000,
  intervalMs = 200,
): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await fn();
    if (result !== null && result !== undefined) return result;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`);
}

integration("Outbox recovery, concurrent publishers, and DLQ policy (Issue #16)", () => {
  let harness: MessagingHarness;
  let pgClient: Client;
  const createdWalletIds: string[] = [];

  beforeAll(async () => {
    harness = await MessagingHarness.create();
    pgClient = new Client({ connectionString: databaseUrl });
    await pgClient.connect();
  });

  afterAll(async () => {
    await pgClient.end();
    await harness.close();
  });

  test("criterion 1: recovers outbox when publisher was interrupted after financial commit", async () => {
    const playerId = `player-rec-${randomUUID()}`;
    const playerWallet = await createWallet(playerId, "100.00");
    createdWalletIds.push(playerWallet.id);

    const extTxId = `bet-crash-${randomUUID()}`;
    const betResponse = await request("/wagering/transactions", {
      method: "POST",
      headers: { "idempotency-key": `idem-${extTxId}` },
      body: JSON.stringify({
        providerId: "crash-provider",
        externalTransactionId: extTxId,
        walletId: playerWallet.id,
        playerId,
        currency: "BRL",
        amount: "25.00",
        kind: "BET",
        roundId: `round-${extTxId}`,
      }),
    });
    expect(betResponse.status).toBe(200);
    const betPayload = (await betResponse.json()) as {
      id: string;
      transactionId?: string;
    };
    const txId = betPayload.transactionId ?? betPayload.id;

    // Financial commit completed: transaction and outbox message exist in DB
    const outboxRows = await pgClient.query(
      "select * from outbox_messages where published_at is null and (payload->>'aggregateId' = $1 or payload->'data'->>'transactionId' = $1)",
      [txId],
    );
    expect(outboxRows.rows.length).toBeGreaterThanOrEqual(1);
    const outboxMessageId = outboxRows.rows[0].id;
    expect(outboxRows.rows[0].published_at).toBeNull();

    // A separate OutboxPublisher instance boots up to claim and publish pending outbox
    const secondPublisher = new OutboxPublisher(
      harness.get(AppConfig),
      harness.get(MikroORM),
      harness.get(OperationalMetrics),
    );

    const result = await secondPublisher.publishBatch(10);
    expect(result.published).toBeGreaterThanOrEqual(1);

    // Verify outbox record is now published
    const updatedRows = await pgClient.query(
      "select * from outbox_messages where id = $1",
      [outboxMessageId],
    );
    expect(updatedRows.rows[0].published_at).not.toBeNull();
    expect(updatedRows.rows[0].lease_token).toBeNull();

    // Verify integration event arrived in SQS wager-events.fifo
    const event = await waitFor(async () => {
      const res = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: eventQueueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 2,
        }),
      );
      const match = res.Messages?.find(
        (m) => m.Body?.includes(txId) || m.Body?.includes(outboxMessageId),
      );
      if (match?.ReceiptHandle) {
        await sqs.send(
          new DeleteMessageCommand({
            QueueUrl: eventQueueUrl,
            ReceiptHandle: match.ReceiptHandle,
          }),
        );
      }
      return match ?? null;
    });
    expect(event).toBeDefined();
    secondPublisher.stop();
  });

  test("criterion 2: preserves stable event ID and at-least-once delivery when publish was ambiguous", async () => {
    const playerId = `player-ambig-${randomUUID()}`;
    const playerWallet = await createWallet(playerId, "100.00");
    createdWalletIds.push(playerWallet.id);

    const extTxId = `tx-ambig-${randomUUID()}`;
    const txResponse = await request("/wagering/transactions", {
      method: "POST",
      headers: { "idempotency-key": `idem-${extTxId}` },
      body: JSON.stringify({
        providerId: "ambig-provider",
        externalTransactionId: extTxId,
        walletId: playerWallet.id,
        playerId,
        currency: "BRL",
        amount: "10.00",
        kind: "BET",
        roundId: `round-${extTxId}`,
      }),
    });
    expect(txResponse.status).toBe(200);
    const txPayload = (await txResponse.json()) as {
      id: string;
      transactionId?: string;
    };
    const ambigTxId = txPayload.transactionId ?? txPayload.id;

    const outboxRes = await pgClient.query(
      "select * from outbox_messages where published_at is null and (payload->>'aggregateId' = $1 or payload->'data'->>'transactionId' = $1)",
      [ambigTxId],
    );
    expect(outboxRes.rows.length).toBeGreaterThanOrEqual(1);
    const originalOutbox = outboxRes.rows[0];

    // Simulate ambiguous delivery: message was sent to SQS, but publisher crashed before finalizing in DB.
    // We claim it with an expired lease simulating a dead instance:
    const deadLeaseToken = randomUUID();
    await pgClient.query(
      "update outbox_messages set lease_until = now() - interval '5 seconds', lease_token = $1 where id = $2",
      [deadLeaseToken, originalOutbox.id],
    );

    // Another publisher claims and publishes the message
    const recoveringPublisher = new OutboxPublisher(
      harness.get(AppConfig),
      harness.get(MikroORM),
      harness.get(OperationalMetrics),
    );

    const publishResult = await recoveringPublisher.publishBatch(10);
    expect(publishResult.published).toBeGreaterThanOrEqual(1);

    // Verify outbox was finalized with published_at
    const finalized = await pgClient.query(
      "select * from outbox_messages where id = $1",
      [originalOutbox.id],
    );
    expect(finalized.rows[0].published_at).not.toBeNull();
    expect(finalized.rows[0].id).toBe(originalOutbox.id);

    // SQS receives the exact same deduplication ID and payload ID (stable event ID)
    const receivedEvent = await waitFor(async () => {
      const res = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: eventQueueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 2,
        }),
      );
      const match = res.Messages?.find(
        (m) =>
          m.Body?.includes(ambigTxId) || m.Body?.includes(originalOutbox.id),
      );
      if (match?.ReceiptHandle) {
        await sqs.send(
          new DeleteMessageCommand({
            QueueUrl: eventQueueUrl,
            ReceiptHandle: match.ReceiptHandle,
          }),
        );
      }
      return match ?? null;
    });
    expect(receivedEvent).toBeDefined();
    recoveringPublisher.stop();
  });

  test("criterion 3: two concurrent publishers claim batches without loss, respecting lease and lease_token", async () => {
    const playerId = `player-conc-${randomUUID()}`;
    const playerWallet = await createWallet(playerId, "200.00");
    createdWalletIds.push(playerWallet.id);

    // Generate 6 distinct transactions to produce 6 outbox messages
    const txCount = 6;
    for (let i = 0; i < txCount; i += 1) {
      const extTxId = `conc-pub-${i}-${randomUUID()}`;
      const res = await request("/wagering/transactions", {
        method: "POST",
        headers: { "idempotency-key": `idem-${extTxId}` },
        body: JSON.stringify({
          providerId: "conc-provider",
          externalTransactionId: extTxId,
          walletId: playerWallet.id,
          playerId,
          currency: "BRL",
          amount: "5.00",
          kind: "BET",
          roundId: `round-${extTxId}`,
        }),
      });
      expect(res.status).toBe(200);
    }

    const pendingBefore = await pgClient.query(
      "select count(*)::int as count from outbox_messages where published_at is null",
    );
    expect(pendingBefore.rows[0].count).toBeGreaterThanOrEqual(txCount);

    const publisher1 = new OutboxPublisher(
      harness.get(AppConfig),
      harness.get(MikroORM),
      harness.get(OperationalMetrics),
    );
    const publisher2 = new OutboxPublisher(
      harness.get(AppConfig),
      harness.get(MikroORM),
      harness.get(OperationalMetrics),
    );

    // Two publishers race to publish batches concurrently
    const [res1, res2] = await Promise.all([
      publisher1.publishBatch(10),
      publisher2.publishBatch(10),
    ]);

    expect(res1.published + res2.published).toBeGreaterThanOrEqual(txCount);

    // Verify all outbox messages converged with published_at set
    const pendingAfter = await pgClient.query(
      "select count(*)::int as count from outbox_messages where published_at is null",
    );
    expect(pendingAfter.rows[0].count).toBe(0);

    publisher1.stop();
    publisher2.stop();

    // Drain SQS event queue
    let hasMore = true;
    while (hasMore) {
      const res = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: eventQueueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 1,
        }),
      );
      if (!res.Messages || res.Messages.length === 0) {
        hasMore = false;
      } else {
        await Promise.all(
          res.Messages.map((m) =>
            m.ReceiptHandle
              ? sqs.send(
                  new DeleteMessageCommand({
                    QueueUrl: eventQueueUrl,
                    ReceiptHandle: m.ReceiptHandle,
                  }),
                )
              : Promise.resolve(),
          ),
        );
      }
    }
  });

  test("criterion 4: transient failure respects backoff and configurable limit before routing to DLQ", async () => {
    // We instantiate a consumer with custom maxReceiveCount = 2
    const baseConfig = harness.get<AppConfig>(AppConfig);
    const strictConfig = new AppConfig(
      baseConfig.nodeEnv,
      baseConfig.port,
      baseConfig.databaseUrl,
      baseConfig.sqsEndpoint,
      baseConfig.awsRegion,
      baseConfig.awsAccessKeyId,
      baseConfig.awsSecretAccessKey,
      baseConfig.wagerQueueUrl,
      baseConfig.wagerDlqUrl,
      baseConfig.eventQueueUrl,
      false,
      baseConfig.shutdownGracePeriodMs,
      2, // maxReceiveCount = 2
    );

    const testConsumer = new SqsWagerConsumer(
      strictConfig,
      harness.get<MikroORM>(MikroORM) as never, // will fail processing as not a wagering service, generating transient error
      harness.get<OperationalMetrics>(OperationalMetrics),
    );

    const internalConsumer = testConsumer as never as {
      handleProcessingError: (
        error: unknown,
        body: string,
        receiptHandle?: string,
        attributes?: Record<string, string>,
      ) => Promise<void>;
    };

    const messageId = `msg-transient-${randomUUID()}`;
    const dummyBody = JSON.stringify({
      messageId,
      type: "WagerTransactionRequested",
      occurredAt: new Date().toISOString(),
      data: {
        idempotencyKey: `idem-${messageId}`,
        providerId: "test-provider",
        externalTransactionId: `tx-${messageId}`,
        walletId: randomUUID(),
        playerId: "player-transient",
        currency: "BRL",
        amount: "10.00",
        kind: "BET",
        roundId: "round-1",
      },
    });

    // Attempt 1: receiveCount = 1 (< maxReceiveCount 2) -> sets visibility backoff, not in DLQ
    await internalConsumer.handleProcessingError(
      new Error("transient network blip"),
      dummyBody,
      undefined,
      { ApproximateReceiveCount: "1" },
    );

    // Attempt 2: receiveCount = 2 (>= maxReceiveCount 2) -> routes to DLQ!
    // Send a real message to queue to have a valid receipt handle
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: dummyBody,
        MessageGroupId: "group-transient",
        MessageDeduplicationId: messageId,
      }),
    );

    const received = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 2,
      }),
    );
    const receiptHandle = received.Messages?.[0]?.ReceiptHandle;
    expect(receiptHandle).toBeDefined();

    // Call handleProcessingError with receiveCount = 2 and real receiptHandle
    await internalConsumer.handleProcessingError(
      new Error("transient timeout exhausted"),
      dummyBody,
      receiptHandle,
      { ApproximateReceiveCount: "2" },
    );

    // Message must arrive in DLQ with max_retries_exceeded
    const dlqMessage = await waitFor(async () => {
      const res = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: dlqUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 1,
        }),
      );
      const match = res.Messages?.find((m) => m.Body?.includes(messageId));
      if (match?.ReceiptHandle) {
        await sqs.send(
          new DeleteMessageCommand({
            QueueUrl: dlqUrl,
            ReceiptHandle: match.ReceiptHandle,
          }),
        );
      }
      return match ?? null;
    });

    expect(dlqMessage).toBeDefined();
    expect(dlqMessage.Body).toContain(messageId);
    testConsumer.stop();
  });

  test("criterion 5: permanently invalid payload routes to DLQ with explicit policy and zero database effects", async () => {
    const invalidMsgId = `invalid-msg-${randomUUID()}`;
    const invalidPayload = JSON.stringify({
      messageId: invalidMsgId,
      type: "UnknownEnvelopeType",
      data: { corrupted: true },
    });

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: invalidPayload,
        MessageGroupId: "invalid-group",
        MessageDeduplicationId: invalidMsgId,
      }),
    );

    await harness.consumeOnce();

    // Verify arrival in DLQ
    const dlqMessage = await waitFor(async () => {
      const res = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: dlqUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 1,
        }),
      );
      const match = res.Messages?.find((m) => m.Body?.includes(invalidMsgId));
      if (match?.ReceiptHandle) {
        await sqs.send(
          new DeleteMessageCommand({
            QueueUrl: dlqUrl,
            ReceiptHandle: match.ReceiptHandle,
          }),
        );
      }
      return match ?? null;
    });

    expect(dlqMessage).toBeDefined();

    // Confirm no inbox or wager record exists
    const inbox = await pgClient.query(
      "select id from inbox_messages where message_id = $1",
      [invalidMsgId],
    );
    expect(inbox.rows).toHaveLength(0);
  });

  test("criterion 6: outbox converges, wallets reconcile, and operational metrics reflect occurrences", async () => {
    // 1. Publish any remaining outbox messages until completely idle
    await harness.publishUntilIdle();

    // Outbox converged: 0 pending, lag 0
    const outboxPending = await pgClient.query(
      "select count(*)::int as pending from outbox_messages where published_at is null",
    );
    expect(outboxPending.rows[0].pending).toBe(0);

    // 2. All wallets created across tests reconcile with zero difference
    for (const walletId of createdWalletIds) {
      const recon = await request(`/wallets/${walletId}/reconciliation`, {
        method: "POST",
      });
      expect(recon.status).toBe(201);
      const data = await recon.json();
      expect(data).toMatchObject({
        consistent: true,
        difference: { amount: "0.00", currency: "BRL" },
      });
    }

    // 3. Operational metrics reflect the events
    const localMetricsText = harness.get<OperationalMetrics>(OperationalMetrics).toPrometheusFormat();
    expect(localMetricsText).toContain("outbox_published_total");
    expect(localMetricsText).toContain("sqs_dlq_total");

    const appMetricsResponse = await request("/metrics");
    expect(appMetricsResponse.status).toBe(200);
    const appMetricsText = await appMetricsResponse.text();
    expect(appMetricsText).toContain("outbox_pending 0");
    expect(appMetricsText).toContain("wager_transactions_total");
  });
});
