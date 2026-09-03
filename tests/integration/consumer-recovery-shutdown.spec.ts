import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  ChangeMessageVisibilityCommand,
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

integration("Consumer crash recovery and graceful shutdown", () => {
  test("recovers cleanly when consumer dies after financial commit and before DeleteMessage", async () => {
    const playerId = `player-${randomUUID()}`;
    const playerWallet = await createWallet(playerId, "100.00");
    const externalTransactionId = `crash-bet-${randomUUID()}`;
    const idempotencyKey = `idem-${externalTransactionId}`;
    const messageId = `msg-crash-${randomUUID()}`;

    const envelope = {
      messageId,
      type: "WagerTransactionRequested",
      occurredAt: new Date().toISOString(),
      data: {
        idempotencyKey,
        providerId: "crash-provider",
        externalTransactionId,
        walletId: playerWallet.id,
        playerId,
        currency: "BRL",
        amount: "35.00",
        kind: "BET",
        roundId: `round-${randomUUID()}`,
      },
    };

    // 1. Send SQS message
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(envelope),
        MessageGroupId: playerWallet.id,
        MessageDeduplicationId: `${messageId}-attempt1`,
      }),
    );

    // 2. Start consumer 1, which commits to PostgreSQL but is interrupted before DeleteMessage
    const harness1 = await MessagingHarness.create();
    let interruptedReceiptHandle: string | undefined;

    harness1.getConsumer().onAfterCommitBeforeAck = (ctx) => {
      interruptedReceiptHandle = ctx.receiptHandle;
      // Simulate hard crash / termination of instance immediately after DB commit
      throw new Error("SIMULATED_CONSUMER_CRASH_BEFORE_ACK");
    };

    try {
      await harness1.consumeOnce();
    } catch {
      // Expected failure simulating consumer crash
    } finally {
      await harness1.close();
    }

    // 3. Verify financial commit already occurred in PostgreSQL
    const pgClient = new Client({ connectionString: databaseUrl });
    await pgClient.connect();

    try {
      const txRowsAfterCrash = await pgClient.query(
        "select * from wager_transactions where provider_id = 'crash-provider' and external_transaction_id = $1",
        [externalTransactionId],
      );
      expect(txRowsAfterCrash.rows).toHaveLength(1);
      expect(txRowsAfterCrash.rows[0].status).toBe("PROCESSED");

      const inboxAfterCrash = await pgClient.query(
        "select * from inbox_messages where consumer_name = 'SqsWagerConsumer' and message_id = $1",
        [messageId],
      );
      expect(inboxAfterCrash.rows).toHaveLength(1);

      // 4. Release message visibility to 0 to simulate immediate redelivery/visibility expiry
      if (interruptedReceiptHandle) {
        await sqs.send(
          new ChangeMessageVisibilityCommand({
            QueueUrl: queueUrl,
            ReceiptHandle: interruptedReceiptHandle,
            VisibilityTimeout: 0,
          }),
        );
      }

      // 5. Another consumer instance starts and consumes the redelivered message
      const harness2 = await MessagingHarness.create();
      try {
        await harness2.consumeOnce();
      } finally {
        await harness2.close();
      }

      // 6. Verify invariants: exactly 1 transaction, 1 inbox, 1 debit, and consistent reconciled balance
      const txRowsFinal = await pgClient.query(
        "select * from wager_transactions where provider_id = 'crash-provider' and external_transaction_id = $1",
        [externalTransactionId],
      );
      expect(txRowsFinal.rows).toHaveLength(1);

      const inboxFinal = await pgClient.query(
        "select * from inbox_messages where consumer_name = 'SqsWagerConsumer' and message_id = $1",
        [messageId],
      );
      expect(inboxFinal.rows).toHaveLength(1);

      const ledgerRows = await pgClient.query(
        "select * from wallet_ledger_entries where wallet_id = $1 and direction = 'DEBIT'",
        [playerWallet.id],
      );
      expect(ledgerRows.rows).toHaveLength(1);
      expect(ledgerRows.rows[0].amount).toBe("35.00");

      const walletRows = await pgClient.query(
        "select balance from wallets where id = $1",
        [playerWallet.id],
      );
      expect(walletRows.rows[0].balance).toBe("65.00");

      // Verify wallet reconciliation via HTTP API
      const reconciliation = await request(
        `/wallets/${playerWallet.id}/reconciliation`,
        { method: "POST" },
      );
      expect(reconciliation.status).toBe(201);
      const recData = await reconciliation.json();
      expect(recData).toMatchObject({
        walletId: playerWallet.id,
        storedBalance: { amount: "65.00", currency: "BRL" },
        calculatedBalance: { amount: "65.00", currency: "BRL" },
        difference: { amount: "0.00", currency: "BRL" },
        consistent: true,
      });

      // 7. Verify SQS queue is drained (no messages left)
      const sqsCheck = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 1,
          WaitTimeSeconds: 1,
        }),
      );
      expect(sqsCheck.Messages ?? []).toHaveLength(0);
    } finally {
      await pgClient.end();
    }
  });

  test("graceful shutdown drains in-flight work or releases visibility for safe takeover", async () => {
    const playerId = `player-${randomUUID()}`;
    const playerWallet = await createWallet(playerId, "100.00");
    const externalTransactionId = `sigterm-bet-${randomUUID()}`;
    const idempotencyKey = `idem-${externalTransactionId}`;
    const messageId = `msg-sigterm-${randomUUID()}`;

    const envelope = {
      messageId,
      type: "WagerTransactionRequested",
      occurredAt: new Date().toISOString(),
      data: {
        idempotencyKey,
        providerId: "sigterm-provider",
        externalTransactionId,
        walletId: playerWallet.id,
        playerId,
        currency: "BRL",
        amount: "20.00",
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

    // Instance 1 processes with graceful shutdown initiated
    const harness1 = await MessagingHarness.create();
    const consumer1 = harness1.getConsumer();

    // Consume and simultaneously initiate graceful shutdown with ample grace period
    const consumePromise = harness1.consumeOnce();
    const shutdownPromise = consumer1.shutdown(3000);

    await Promise.all([consumePromise, shutdownPromise]);
    await harness1.close();

    // Verify through second instance that queue state and database are completely settled
    const harness2 = await MessagingHarness.create();
    try {
      await harness2.consumeOnce();
    } finally {
      await harness2.close();
    }

    const pgClient = new Client({ connectionString: databaseUrl });
    await pgClient.connect();

    try {
      const tx = await waitFor(async () => {
        const res = await pgClient.query(
          "select * from wager_transactions where provider_id = 'sigterm-provider' and external_transaction_id = $1",
          [externalTransactionId],
        );
        return res.rows.length > 0 && res.rows[0].status === "PROCESSED"
          ? res.rows[0]
          : null;
      });
      expect(tx.status).toBe("PROCESSED");

      const reconciliation = await request(
        `/wallets/${playerWallet.id}/reconciliation`,
        { method: "POST" },
      );
      expect(await reconciliation.json()).toMatchObject({
        storedBalance: { amount: "80.00", currency: "BRL" },
        calculatedBalance: { amount: "80.00", currency: "BRL" },
        difference: { amount: "0.00", currency: "BRL" },
        consistent: true,
      });
    } finally {
      await pgClient.end();
    }
  });

  test("sends SIGTERM to a worker process during processing and proves safe resumption by another instance", async () => {
    const playerId = `player-${randomUUID()}`;
    const playerWallet = await createWallet(playerId, "100.00");
    const externalTransactionId = `proc-sigterm-${randomUUID()}`;
    const idempotencyKey = `idem-${externalTransactionId}`;
    const messageId = `msg-proc-sigterm-${randomUUID()}`;

    const envelope = {
      messageId,
      type: "WagerTransactionRequested",
      occurredAt: new Date().toISOString(),
      data: {
        idempotencyKey,
        providerId: "process-provider",
        externalTransactionId,
        walletId: playerWallet.id,
        playerId,
        currency: "BRL",
        amount: "40.00",
        kind: "BET",
        roundId: `round-${randomUUID()}`,
      },
    };

    // 1. Send SQS message
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(envelope),
        MessageGroupId: playerWallet.id,
        MessageDeduplicationId: messageId,
      }),
    );

    // 2. Spawn worker child process
    const proc = Bun.spawn([process.execPath, "run", "scripts/test-worker-runner.ts"], {
      env: {
        ...process.env,
        NODE_ENV: "test",
        TEST_WORKERS_AUTOSTART: "true",
        SHUTDOWN_GRACE_PERIOD_MS: "3000",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    // Wait a brief moment for worker process to boot and process message
    await new Promise((resolve) => setTimeout(resolve, 800));

    // Send SIGTERM to worker process
    proc.kill("SIGTERM");
    await proc.exited;

    // 3. Second instance ensures any remaining queue work is processed
    const harness = await MessagingHarness.create();
    try {
      await harness.consumeOnce();
    } finally {
      await harness.close();
    }

    // 4. Verify exactly 1 transaction, 1 debit, and consistent reconciled balance
    const pgClient = new Client({ connectionString: databaseUrl });
    await pgClient.connect();

    try {
      const tx = await waitFor(async () => {
        const res = await pgClient.query(
          "select * from wager_transactions where provider_id = 'process-provider' and external_transaction_id = $1",
          [externalTransactionId],
        );
        return res.rows.length > 0 && res.rows[0].status === "PROCESSED"
          ? res.rows[0]
          : null;
      });
      expect(tx.status).toBe("PROCESSED");

      const ledger = await pgClient.query(
        "select * from wallet_ledger_entries where wallet_id = $1 and direction = 'DEBIT'",
        [playerWallet.id],
      );
      expect(ledger.rows).toHaveLength(1);
      expect(ledger.rows[0].amount).toBe("40.00");

      const reconciliation = await request(
        `/wallets/${playerWallet.id}/reconciliation`,
        { method: "POST" },
      );
      expect(await reconciliation.json()).toMatchObject({
        storedBalance: { amount: "60.00", currency: "BRL" },
        calculatedBalance: { amount: "60.00", currency: "BRL" },
        difference: { amount: "0.00", currency: "BRL" },
        consistent: true,
      });
    } finally {
      await pgClient.end();
    }
  });
});
