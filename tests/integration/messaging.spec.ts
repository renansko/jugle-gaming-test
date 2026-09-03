import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { Client } from "pg";
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

integration("SQS messaging integration", () => {
  let harness: MessagingHarness;

  beforeAll(async () => {
    harness = await MessagingHarness.create();
  });

  afterAll(async () => {
    await harness.close();
  });

  test("processes WagerTransactionRequested atomically and publishes integration events", async () => {
    const playerId = `player-${randomUUID()}`;
    const playerWallet = await createWallet(playerId, "100.00");
    const externalTransactionId = `sqs-bet-${randomUUID()}`;
    const idempotencyKey = `idem-${externalTransactionId}`;
    const messageId = `msg-${randomUUID()}`;

    const envelope = {
      messageId,
      type: "WagerTransactionRequested",
      occurredAt: new Date().toISOString(),
      data: {
        idempotencyKey,
        providerId: "sqs-provider",
        externalTransactionId,
        walletId: playerWallet.id,
        playerId,
        currency: "BRL",
        amount: "30.00",
        kind: "BET",
        roundId: `round-${randomUUID()}`,
      },
    };

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(envelope),
        MessageGroupId: playerWallet.id,
        MessageDeduplicationId: messageId,
      }),
    );
    await harness.consumeOnce();
    await harness.publishUntilIdle();

    // Wait for the transaction to be processed
    const pgClient = new Client({ connectionString: databaseUrl });
    await pgClient.connect();

    try {
      const transaction = await waitFor(async () => {
        await harness.consumeOnce();
        await harness.publishUntilIdle().catch(() => undefined);
        const res = await pgClient.query(
          "select * from wager_transactions where provider_id = 'sqs-provider' and external_transaction_id = $1",
          [externalTransactionId],
        );
        return res.rows.length > 0 && res.rows[0].status === "PROCESSED"
          ? res.rows[0]
          : null;
      });

      expect(transaction.status).toBe("PROCESSED");
      expect(transaction.amount).toBe("30.00");

      // Verify inbox table entry
      const inboxRows = await pgClient.query(
        "select * from inbox_messages where consumer_name = 'SqsWagerConsumer' and message_id = $1",
        [messageId],
      );
      expect(inboxRows.rows).toHaveLength(1);

      // Verify ledger debit entry
      const ledgerRows = await pgClient.query(
        "select * from wallet_ledger_entries where wallet_id = $1 and transaction_id = $2",
        [playerWallet.id, transaction.id],
      );
      expect(ledgerRows.rows).toHaveLength(1);
      expect(ledgerRows.rows[0].direction).toBe("DEBIT");
      expect(ledgerRows.rows[0].balance_after).toBe("70.00");

      // Verify wallet balance
      const walletRows = await pgClient.query(
        "select * from wallets where id = $1",
        [playerWallet.id],
      );
      expect(walletRows.rows[0].balance).toBe("70.00");

      // Reconcile via HTTP
      const reconciliation = await request(
        `/wallets/${playerWallet.id}/reconciliation`,
        { method: "POST" },
      );
      expect(reconciliation.status).toBe(201);
      expect(await reconciliation.json()).toMatchObject({
        storedBalance: { amount: "70.00", currency: "BRL" },
        calculatedBalance: { amount: "70.00", currency: "BRL" },
        difference: { amount: "0.00", currency: "BRL" },
        consistent: true,
      });

      // Verify event was published to wager-events.fifo
      const eventMessage = await waitFor(async () => {
        const res = await sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: eventQueueUrl,
            MaxNumberOfMessages: 10,
            WaitTimeSeconds: 2,
          }),
        );
        const match = res.Messages?.find((m) => {
          try {
            const body = JSON.parse(m.Body ?? "");
            return (
              body.correlationId === messageId ||
              body.aggregateId === transaction.id ||
              body.data?.transactionId === transaction.id
            );
          } catch {
            return false;
          }
        });

        await Promise.all(
          (res.Messages ?? []).map((message) =>
            message.ReceiptHandle
              ? sqs.send(
                  new DeleteMessageCommand({
                    QueueUrl: eventQueueUrl,
                    ReceiptHandle: message.ReceiptHandle,
                  }),
                )
              : Promise.resolve(),
          ),
        );

        return match ?? null;
      });

      expect(eventMessage).toBeDefined();
    } finally {
      await pgClient.end();
    }
  });

  test("SQS redelivery of identical payload is idempotent and produces no extra financial side effect", async () => {
    const playerId = `player-${randomUUID()}`;
    const playerWallet = await createWallet(playerId, "100.00");
    const externalTransactionId = `sqs-idem-${randomUUID()}`;
    const idempotencyKey = `idem-${externalTransactionId}`;
    const messageId = `msg-${randomUUID()}`;

    const envelope = {
      messageId,
      type: "WagerTransactionRequested",
      occurredAt: new Date().toISOString(),
      data: {
        idempotencyKey,
        providerId: "sqs-provider",
        externalTransactionId,
        walletId: playerWallet.id,
        playerId,
        currency: "BRL",
        amount: "25.00",
        kind: "BET",
        roundId: `round-${randomUUID()}`,
      },
    };

    // First send
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(envelope),
        MessageGroupId: playerWallet.id,
        MessageDeduplicationId: `${messageId}-attempt1`,
      }),
    );
    await harness.consumeOnce();

    const pgClient = new Client({ connectionString: databaseUrl });
    await pgClient.connect();

    try {
      await waitFor(async () => {
        await harness.consumeOnce();
        const res = await pgClient.query(
          "select * from wager_transactions where provider_id = 'sqs-provider' and external_transaction_id = $1",
          [externalTransactionId],
        );
        return res.rows.length > 0 && res.rows[0].status === "PROCESSED"
          ? res.rows[0]
          : null;
      });

      // Second send (redelivery with same payload and messageId, different SQS dedup ID)
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify(envelope),
          MessageGroupId: playerWallet.id,
          MessageDeduplicationId: `${messageId}-attempt2`,
        }),
      );
      await harness.consumeOnce();

      // Give worker a moment to process redelivery
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Verify invariants: only 1 transaction, 1 debit, balance 75.00
      const txRows = await pgClient.query(
        "select * from wager_transactions where provider_id = 'sqs-provider' and external_transaction_id = $1",
        [externalTransactionId],
      );
      expect(txRows.rows).toHaveLength(1);

      const ledgerRows = await pgClient.query(
        "select * from wallet_ledger_entries where wallet_id = $1 and direction = 'DEBIT'",
        [playerWallet.id],
      );
      expect(ledgerRows.rows).toHaveLength(1);

      const inboxRows = await pgClient.query(
        "select * from inbox_messages where consumer_name = 'SqsWagerConsumer' and message_id = $1",
        [messageId],
      );
      expect(inboxRows.rows).toHaveLength(1);

      const walletRows = await pgClient.query(
        "select * from wallets where id = $1",
        [playerWallet.id],
      );
      expect(walletRows.rows[0].balance).toBe("75.00");

      const reconciliation = await request(
        `/wallets/${playerWallet.id}/reconciliation`,
        { method: "POST" },
      );
      expect(await reconciliation.json()).toMatchObject({
        storedBalance: { amount: "75.00", currency: "BRL" },
        calculatedBalance: { amount: "75.00", currency: "BRL" },
        consistent: true,
      });
    } finally {
      await pgClient.end();
    }
  });

  test("routes a divergent reuse of messageId to DLQ without a second financial effect", async () => {
    const playerId = `player-${randomUUID()}`;
    const playerWallet = await createWallet(playerId, "100.00");
    const externalTransactionId = `sqs-conflict-${randomUUID()}`;
    const messageId = `msg-${randomUUID()}`;
    const envelope = {
      messageId,
      type: "WagerTransactionRequested",
      occurredAt: new Date().toISOString(),
      data: {
        idempotencyKey: `idem-${externalTransactionId}`,
        providerId: "sqs-provider",
        externalTransactionId,
        walletId: playerWallet.id,
        playerId,
        money: { amount: "10.00", currency: "BRL" },
        kind: "BET",
        roundId: `round-${randomUUID()}`,
        gameId: "conflict-game",
      },
    };

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(envelope),
        MessageGroupId: playerWallet.id,
        MessageDeduplicationId: `${messageId}-original`,
      }),
    );
    await harness.consumeOnce();

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({
          ...envelope,
          occurredAt: new Date().toISOString(),
          data: {
            ...envelope.data,
            money: { amount: "11.00", currency: "BRL" },
          },
        }),
        MessageGroupId: playerWallet.id,
        MessageDeduplicationId: `${messageId}-divergent`,
      }),
    );
    await harness.consumeOnce();

    const dlqMessage = await waitFor(async () => {
      const response = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: dlqUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 1,
        }),
      );
      const match = response.Messages?.find((message) =>
        message.Body?.includes(messageId),
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

    const pgClient = new Client({ connectionString: databaseUrl });
    await pgClient.connect();
    try {
      const transactions = await pgClient.query(
        "select id from wager_transactions where provider_id = 'sqs-provider' and external_transaction_id = $1",
        [externalTransactionId],
      );
      expect(transactions.rows).toHaveLength(1);

      const ledger = await pgClient.query(
        "select id from wallet_ledger_entries where transaction_id = $1",
        [transactions.rows[0].id],
      );
      expect(ledger.rows).toHaveLength(1);

      const wallet = await pgClient.query(
        "select balance from wallets where id = $1",
        [playerWallet.id],
      );
      expect(wallet.rows[0].balance).toBe("90.00");
    } finally {
      await pgClient.end();
    }
  });
});
