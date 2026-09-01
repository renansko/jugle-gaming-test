import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

const baseUrl = process.env.TEST_APP_URL;
const integration = baseUrl ? describe : describe.skip;

type Wallet = { id: string; balance: { amount: string; currency: string } };
type Transaction = { id: string; status: string; idempotentReplay: boolean };

async function request(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
}

async function createWallet(playerId: string, initialBalance = "100.00"): Promise<Wallet> {
  const response = await request("/wallets", {
    method: "POST",
    body: JSON.stringify({ playerId, currency: "BRL", initialBalance }),
  });
  expect(response.status).toBe(201);
  return response.json() as Promise<Wallet>;
}

integration("HTTP integration", () => {
  test("replays an identical request and rejects a changed payload with the same key", async () => {
    const playerId = `player-${randomUUID()}`;
    const playerWallet = await createWallet(playerId);
    const idempotencyKey = `idem-${randomUUID()}`;
    const requestBody = {
      providerId: "integration-provider", externalTransactionId: `bet-${randomUUID()}`, walletId: playerWallet.id, playerId,
      currency: "BRL", amount: "20.00", kind: "BET", roundId: `round-${randomUUID()}`,
    };
    const first = await request("/wagering/transactions", {
      method: "POST", headers: { "idempotency-key": idempotencyKey }, body: JSON.stringify(requestBody),
    });
    expect(first.status).toBe(200);
    const original = await first.json() as Transaction;

    const replay = await request("/wagering/transactions", {
      method: "POST", headers: { "idempotency-key": idempotencyKey }, body: JSON.stringify(requestBody),
    });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ id: original.id, status: "PROCESSED", idempotentReplay: true });

    const conflict = await request("/wagering/transactions", {
      method: "POST", headers: { "idempotency-key": idempotencyKey }, body: JSON.stringify({ ...requestBody, amount: "21.00" }),
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  test("persists the wager, ledger, and reconciliation atomically", async () => {
    const playerId = `player-${randomUUID()}`;
    const playerWallet = await createWallet(playerId);
    const externalTransactionId = `bet-${randomUUID()}`;
    const transactionResponse = await request("/wagering/transactions", {
      method: "POST",
      headers: { "idempotency-key": `idem-${externalTransactionId}` },
      body: JSON.stringify({
        providerId: "integration-provider",
        externalTransactionId,
        walletId: playerWallet.id,
        playerId,
        currency: "BRL",
        amount: "20.00",
        kind: "BET",
        roundId: `round-${randomUUID()}`,
      }),
    });
    expect(transactionResponse.status).toBe(200);
    expect((await transactionResponse.json()) as Transaction).toMatchObject({ status: "PROCESSED" });

    const reconciliation = await request(`/wallets/${playerWallet.id}/reconciliation`, { method: "POST" });
    expect(reconciliation.status).toBe(201);
    expect(await reconciliation.json()).toMatchObject({
      storedBalance: "80.00",
      calculatedBalance: "80.00",
      difference: "0.00",
      consistent: true,
      checkedEntries: 2,
    });
    const ledger = await request(`/wallets/${playerWallet.id}/ledger`);
    expect(((await ledger.json()) as { items: unknown[] }).items).toHaveLength(2);
  });
});
