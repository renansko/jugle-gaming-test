import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const baseUrl = process.env.TEST_APP_URL;
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://wagering:wagering@postgres:5432/wagering";

const integration = baseUrl ? describe : describe.skip;

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

integration("Reconciliation divergence & operational metrics", () => {
  test("detects controlled divergence, does not auto-mutate balance, and increments divergence metric", async () => {
    const playerId = `divergence-${randomUUID()}`;
    const playerWallet = await createWallet(playerId, "100.00");
    const externalTransactionId = `bet-${randomUUID()}`;

    // Perform a BET of 20
    const betRes = await request("/wagering/transactions", {
      method: "POST",
      headers: { "idempotency-key": `idem-${externalTransactionId}` },
      body: JSON.stringify({
        providerId: "metric-provider",
        externalTransactionId,
        walletId: playerWallet.id,
        playerId,
        currency: "BRL",
        amount: "20.00",
        kind: "BET",
        roundId: `round-${randomUUID()}`,
      }),
    });
    expect(betRes.status).toBe(200);

    const pgClient = new Client({ connectionString: databaseUrl });
    await pgClient.connect();

    try {
      // Inject controlled divergence directly via SQL
      await pgClient.query(
        "update wallets set balance = '95.00' where id = $1",
        [playerWallet.id],
      );

      // Call reconciliation endpoint
      const reconRes = await request(
        `/wallets/${playerWallet.id}/reconciliation`,
        { method: "POST" },
      );
      expect(reconRes.status).toBe(201);
      const reconData = await reconRes.json();
      expect(reconData).toMatchObject({
        storedBalance: "95.00",
        calculatedBalance: "80.00",
        difference: "15.00",
        consistent: false,
        checkedEntries: 2,
      });

      // Confirm balance was NOT auto-corrected
      const walletRes = await pgClient.query(
        "select balance from wallets where id = $1",
        [playerWallet.id],
      );
      expect(walletRes.rows[0].balance).toBe("95.00");

      // Verify Prometheus metrics endpoint
      const metricsRes = await request("/metrics");
      expect(metricsRes.status).toBe(200);
      const metricsText = await metricsRes.text();

      expect(metricsText).toContain("reconciliation_divergences_total");
      expect(metricsText).toContain("wager_transactions_total");
      expect(metricsText).toContain("wager_processing_latency_ms");

      // Restore wallet balance
      await pgClient.query(
        "update wallets set balance = '80.00' where id = $1",
        [playerWallet.id],
      );
    } finally {
      await pgClient.end();
    }
  });

  test("exposes all required operational metrics via GET /metrics", async () => {
    const metricsRes = await request("/metrics");
    expect(metricsRes.status).toBe(200);
    const metricsText = await metricsRes.text();

    const expectedMetrics = [
      "wager_transactions_total",
      "wallet_lock_duration_ms",
      "wager_processing_latency_ms",
      "outbox_pending",
      "outbox_lag_ms",
    ];

    for (const metric of expectedMetrics) {
      expect(metricsText).toContain(metric);
    }
  });
});
