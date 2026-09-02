import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { MessagingHarness } from "../support/messaging-harness";

const baseUrl = process.env.TEST_APP_URL;
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://wagering:wagering@postgres:5432/wagering";
const eventQueueUrl =
  process.env.SQS_EVENT_QUEUE_URL ??
  "http://localstack:4566/000000000000/wager-events.fifo";

const integration = baseUrl ? describe : describe.skip;
const sqs = new SQSClient({
  region: process.env.AWS_REGION ?? "us-east-1",
  endpoint: process.env.SQS_ENDPOINT ?? "http://localstack:4566",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "test",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
  },
});

type Wallet = { id: string; balance: { amount: string; currency: string } };
type TransactionOutput = {
  id: string;
  status: string;
  failureCode?: string;
  idempotentReplay: boolean;
};

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
  timeoutMs = 25000,
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

async function waitForEvent(
  transactionId: string,
  eventType: string,
): Promise<Record<string, unknown>> {
  return waitFor(async () => {
    const response = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: eventQueueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 1,
      }),
    );
    let matchedEvent: Record<string, unknown> | null = null;

    for (const message of response.Messages ?? []) {
      try {
        const event = JSON.parse(message.Body ?? "") as Record<
          string,
          unknown
        >;
        if (
          event.eventType === eventType &&
          event.aggregateId === transactionId
        ) {
          matchedEvent = event;
        }
      } catch {
        // Invalid event payloads are irrelevant to this directed assertion.
      }

      if (message.ReceiptHandle) {
        await sqs.send(
          new DeleteMessageCommand({
            QueueUrl: eventQueueUrl,
            ReceiptHandle: message.ReceiptHandle,
          }),
        );
      }
    }

    return matchedEvent;
  });
}

integration("Pending reference & out-of-order resolution", () => {
  let harness: MessagingHarness;

  beforeAll(async () => {
    harness = await MessagingHarness.create();
  });

  afterAll(async () => {
    await harness.close();
  });

  test(
    "resolves out-of-order REFUND once original BET arrives",
    async () => {
      const playerId = `player-${randomUUID()}`;
      const playerWallet = await createWallet(playerId, "100.00");
      const betExternalId = `bet-${randomUUID()}`;
      const refundExternalId = `refund-${randomUUID()}`;
      const roundId = `round-${randomUUID()}`;


    // 1. Submit REFUND before the BET exists
    const refundResponse = await request("/wagering/transactions", {
      method: "POST",
      headers: { "idempotency-key": `idem-${refundExternalId}` },
      body: JSON.stringify({
        providerId: "ref-provider",
        externalTransactionId: refundExternalId,
        walletId: playerWallet.id,
        playerId,
        currency: "BRL",
        amount: "40.00",
        kind: "REFUND",
        roundId,
        referenceExternalTransactionId: betExternalId,
      }),
    });

    expect(refundResponse.status).toBe(202);
    const refundPayload = (await refundResponse.json()) as TransactionOutput;
    expect(refundPayload.status).toBe("PENDING_REFERENCE");

    // 2. Submit the original BET
    const betResponse = await request("/wagering/transactions", {
      method: "POST",
      headers: { "idempotency-key": `idem-${betExternalId}` },
      body: JSON.stringify({
        providerId: "ref-provider",
        externalTransactionId: betExternalId,
        walletId: playerWallet.id,
        playerId,
        currency: "BRL",
        amount: "40.00",
        kind: "BET",
        roundId,
      }),
    });

    expect(betResponse.status).toBe(200);
    const betPayload = (await betResponse.json()) as TransactionOutput;
    expect(betPayload.status).toBe("PROCESSED");
    await harness.resolvePendingOnce();

    // 3. Wait for PendingReferenceWorker loop to resolve the REFUND
    const pgClient = new Client({ connectionString: databaseUrl });
    await pgClient.connect();

    try {
      const resolvedRefund = await waitFor(async () => {
        const res = await pgClient.query(
          "select * from wager_transactions where id = $1",
          [refundPayload.id],
        );
        return res.rows.length > 0 && res.rows[0].status === "PROCESSED"
          ? res.rows[0]
          : null;
      });

      expect(resolvedRefund.status).toBe("PROCESSED");

      // Verify wallet balance: 100 - 40 (BET) + 40 (REFUND) = 100
      const walletRes = await pgClient.query(
        "select balance from wallets where id = $1",
        [playerWallet.id],
      );
      expect(walletRes.rows[0].balance).toBe("100.00");

      // Verify ledger has opening, debit, and credit
      const reconciliation = await request(
        `/wallets/${playerWallet.id}/reconciliation`,
        { method: "POST" },
      );
      expect(await reconciliation.json()).toMatchObject({
        storedBalance: "100.00",
        calculatedBalance: "100.00",
        difference: "0.00",
        consistent: true,
        checkedEntries: 3,
      });
    } finally {
      await pgClient.end();
    }
  }, 30000);


  test("expires orphan pending reference after TTL and marks REJECTED with REFERENCE_NOT_FOUND", async () => {
    const playerId = `player-${randomUUID()}`;
    const playerWallet = await createWallet(playerId, "100.00");
    const refundExternalId = `orphan-refund-${randomUUID()}`;

    // Submit orphan refund
    const refundResponse = await request("/wagering/transactions", {
      method: "POST",
      headers: { "idempotency-key": `idem-${refundExternalId}` },
      body: JSON.stringify({
        providerId: "ref-provider",
        externalTransactionId: refundExternalId,
        walletId: playerWallet.id,
        playerId,
        currency: "BRL",
        amount: "30.00",
        kind: "REFUND",
        roundId: `round-${randomUUID()}`,
        referenceExternalTransactionId: `nonexistent-${randomUUID()}`,
      }),
    });
    expect(refundResponse.status).toBe(202);
    const refundPayload = (await refundResponse.json()) as TransactionOutput;

    // Age the transaction in PostgreSQL to simulate TTL expiry
    const pgClient = new Client({ connectionString: databaseUrl });
    await pgClient.connect();

    try {
      await pgClient.query(
        `update wager_transactions
         set created_at = now() - interval '2 days',
             next_reference_attempt_at = now() - interval '1 minute',
             reference_lease_until = null
         where id = $1`,
        [refundPayload.id],
      );
      await harness.resolvePendingOnce();
      await harness.publishUntilIdle();

      // Wait for PendingReferenceWorker loop to expire it
      const expiredRefund = await waitFor(async () => {
        const res = await pgClient.query(
          "select * from wager_transactions where id = $1",
          [refundPayload.id],
        );
        return res.rows.length > 0 && res.rows[0].status === "REJECTED"
          ? res.rows[0]
          : null;
      });

      expect(expiredRefund.status).toBe("REJECTED");
      expect(expiredRefund.failure_code).toBe("REFERENCE_NOT_FOUND");

      const rejectedEvent = await waitForEvent(
        refundPayload.id,
        "WagerTransactionRejected",
      );
      expect(rejectedEvent.data).toMatchObject({
        transactionId: refundPayload.id,
        status: "REJECTED",
        failureCode: "REFERENCE_NOT_FOUND",
      });

      // Balance remains unchanged (100.00)
      const walletRes = await pgClient.query(
        "select balance from wallets where id = $1",
        [playerWallet.id],
      );
      expect(walletRes.rows[0].balance).toBe("100.00");
    } finally {
      await pgClient.end();
    }
  });

  test("rejects reversal referencing an un-processed transaction with REFERENCE_NOT_PROCESSED", async () => {
    const playerId = `player-${randomUUID()}`;
    const playerWallet = await createWallet(playerId, "50.00");
    const betExternalId = `rejected-bet-${randomUUID()}`;
    const roundId = `round-${randomUUID()}`;

    // 1. Submit a BET that fails due to INSUFFICIENT_FUNDS
    const betResponse = await request("/wagering/transactions", {
      method: "POST",
      headers: { "idempotency-key": `idem-${betExternalId}` },
      body: JSON.stringify({
        providerId: "ref-provider",
        externalTransactionId: betExternalId,
        walletId: playerWallet.id,
        playerId,
        currency: "BRL",
        amount: "200.00",
        kind: "BET",
        roundId,
      }),
    });
    expect(betResponse.status).toBe(422);

    // 2. Submit REFUND referencing the rejected BET
    const refundExternalId = `refund-rejected-${randomUUID()}`;
    const refundResponse = await request("/wagering/transactions", {
      method: "POST",
      headers: { "idempotency-key": `idem-${refundExternalId}` },
      body: JSON.stringify({
        providerId: "ref-provider",
        externalTransactionId: refundExternalId,
        walletId: playerWallet.id,
        playerId,
        currency: "BRL",
        amount: "200.00",
        kind: "REFUND",
        roundId,
        referenceExternalTransactionId: betExternalId,
      }),
    });

    expect(refundResponse.status).toBe(422);
    const refundPayload = (await refundResponse.json()) as TransactionOutput;
    expect(refundPayload).toMatchObject({
      status: "REJECTED",
      failureCode: "REFERENCE_NOT_PROCESSED",
    });
  });
});
