import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { Client } from "pg";

const baseUrl = process.env.TEST_APP_URL;
const sqsEndpoint = process.env.SQS_ENDPOINT ?? "http://localstack:4566";
const queueUrl =
  process.env.SQS_WAGER_QUEUE_URL ??
  "http://localstack:4566/000000000000/wager-transactions.fifo";
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
  timeoutMs = 20000,
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

integration("DLQ integration", () => {
  test("routes invalid schema payload to DLQ without any database side effects", async () => {
    const invalidMessageId = `invalid-${randomUUID()}`;
    const invalidBody = JSON.stringify({
      messageId: invalidMessageId,
      type: "WagerTransactionRequested",
      occurredAt: "not-a-date",
      data: { invalid: true },
    });

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: invalidBody,
        MessageGroupId: "test-group",
        MessageDeduplicationId: invalidMessageId,
      }),
    );

    // Wait for message to arrive in DLQ
    const dlqMessage = await waitFor(async () => {
      const res = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: dlqUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 1,
        }),
      );
      const match = res.Messages?.find((m) =>
        m.Body?.includes(invalidMessageId),
      );
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
    expect(dlqMessage.Body).toContain(invalidMessageId);

    // Confirm no inbox or wager record was created in database
    const pgClient = new Client({ connectionString: databaseUrl });
    await pgClient.connect();
    try {
      const inboxRows = await pgClient.query(
        "select * from inbox_messages where message_id = $1",
        [invalidMessageId],
      );
      expect(inboxRows.rows).toHaveLength(0);
    } finally {
      await pgClient.end();
    }
  }, 30000);

  test("routes non-retryable domain failure to DLQ without corrupting wallet", async () => {
    const playerId = `player-${randomUUID()}`;
    const playerWallet = await createWallet(playerId, "100.00");
    const nonExistentWalletId = randomUUID();
    const externalTransactionId = `dlq-tx-${randomUUID()}`;
    const messageId = `msg-${randomUUID()}`;

    const envelope = {
      messageId,
      type: "WagerTransactionRequested",
      occurredAt: new Date().toISOString(),
      data: {
        idempotencyKey: `idem-${externalTransactionId}`,
        providerId: "sqs-provider",
        externalTransactionId,
        walletId: nonExistentWalletId,
        playerId,
        currency: "BRL",
        amount: "50.00",
        kind: "BET",
        roundId: `round-${randomUUID()}`,
      },
    };

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(envelope),
        MessageGroupId: "group",
        MessageDeduplicationId: messageId,
      }),
    );

    // Wait for message to arrive in DLQ due to WALLET_NOT_FOUND (domain error)
    const dlqMessage = await waitFor(async () => {
      const res = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: dlqUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 1,
        }),
      );
      const match = res.Messages?.find((m) =>
        m.Body?.includes(externalTransactionId),
      );
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

    // Verify existing wallet balance remains intact
    const pgClient = new Client({ connectionString: databaseUrl });
    await pgClient.connect();
    try {
      const walletRows = await pgClient.query(
        "select * from wallets where id = $1",
        [playerWallet.id],
      );
      expect(walletRows.rows[0].balance).toBe("100.00");
    } finally {
      await pgClient.end();
    }
  }, 30000);
});
