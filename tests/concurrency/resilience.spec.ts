import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const baseUrl = process.env.TEST_APP_URL;
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://wagering:wagering@postgres:5432/wagering";

const concurrency = baseUrl ? describe : describe.skip;

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

concurrency("Multi-wallet concurrency & system resilience", () => {
  test("processes 20 distinct wallets in parallel without cross-wallet blocking", async () => {
    const walletCount = 20;
    const playerIds = Array.from(
      { length: walletCount },
      () => `parallel-player-${randomUUID()}`,
    );
    const wallets = await Promise.all(
      playerIds.map((playerId) => createWallet(playerId, "100.00")),
    );

    const results = await Promise.all(
      wallets.map(async (w, index) => {
        const extId = `parallel-bet-${index}-${randomUUID()}`;
        return request("/wagering/transactions", {
          method: "POST",
          headers: { "idempotency-key": `idem-${extId}` },
          body: JSON.stringify({
            providerId: "concurrency-provider",
            externalTransactionId: extId,
            walletId: w.id,
            playerId: playerIds[index],
            currency: "BRL",
            amount: "15.00",
            kind: "BET",
            roundId: `round-${randomUUID()}`,
          }),
        });
      }),
    );

    expect(results.every((r) => r.status === 200)).toBe(true);

    // Verify all 20 wallets reconciled cleanly to 85.00
    const reconciliations = await Promise.all(
      wallets.map((w) =>
        request(`/wallets/${w.id}/reconciliation`, { method: "POST" }),
      ),
    );

    for (const r of reconciliations) {
      expect(r.status).toBe(201);
      const data = await r.json();
      expect(data).toMatchObject({
        storedBalance: "85.00",
        calculatedBalance: "85.00",
        difference: "0.00",
        consistent: true,
      });
    }
  });

  test("verifies database-wide mathematical invariants across all transactions and ledger entries", async () => {
    const pgClient = new Client({ connectionString: databaseUrl });
    await pgClient.connect();

    try {
      // 1. Verify no orphan ledger entries
      const orphanLedger = await pgClient.query(`
        select l.id from wallet_ledger_entries l
        left join wallets w on w.id = l.wallet_id
        left join wager_transactions t on t.id = l.transaction_id
        where w.id is null or t.id is null
      `);
      expect(orphanLedger.rows).toHaveLength(0);

      // 2. Verify all wallets have balance == sum(credits) - sum(debits)
      const balanceCheck = await pgClient.query(`
        with ledger_sum as (
          select
            wallet_id,
            sum(case when direction = 'CREDIT' then amount else -amount end) as calculated
          from wallet_ledger_entries
          group by wallet_id
        )
        select
          w.id,
          w.balance::numeric as stored,
          coalesce(l.calculated, 0)::numeric as calculated
        from wallets w
        left join ledger_sum l on l.wallet_id = w.id
        where w.balance::numeric != coalesce(l.calculated, 0)::numeric
      `);
      expect(balanceCheck.rows).toHaveLength(0);

      // 3. Verify no outbox messages stuck indefinitely in lease
      const stuckOutbox = await pgClient.query(`
        select id from outbox_messages
        where lease_until < now() - interval '5 minutes' and published_at is null
      `);
      expect(stuckOutbox.rows).toHaveLength(0);
    } finally {
      await pgClient.end();
    }
  });
});
