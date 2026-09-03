import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

const baseUrl = process.env.TEST_APP_URL;
const integration = baseUrl ? describe : describe.skip;

type Wallet = { id: string; balance: { amount: string; currency: string } };
type Transaction = { id: string; status: string; idempotentReplay: boolean };

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

integration("HTTP integration", () => {
  test("replays an identical request and rejects a changed payload with the same key", async () => {
    const playerId = `player-${randomUUID()}`;
    const playerWallet = await createWallet(playerId);
    const idempotencyKey = `idem-${randomUUID()}`;
    const requestBody = {
      providerId: "integration-provider",
      externalTransactionId: `bet-${randomUUID()}`,
      walletId: playerWallet.id,
      playerId,
      currency: "BRL",
      amount: "20.00",
      kind: "BET",
      roundId: `round-${randomUUID()}`,
    };
    const first = await request("/wagering/transactions", {
      method: "POST",
      headers: { "idempotency-key": idempotencyKey },
      body: JSON.stringify(requestBody),
    });
    expect(first.status).toBe(200);
    const original = (await first.json()) as Transaction;

    const replay = await request("/wagering/transactions", {
      method: "POST",
      headers: { "idempotency-key": idempotencyKey },
      body: JSON.stringify(requestBody),
    });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      id: original.id,
      status: "PROCESSED",
      idempotentReplay: true,
    });

    const conflict = await request("/wagering/transactions", {
      method: "POST",
      headers: { "idempotency-key": idempotencyKey },
      body: JSON.stringify({ ...requestBody, amount: "21.00" }),
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
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
    expect((await transactionResponse.json()) as Transaction).toMatchObject({
      status: "PROCESSED",
    });

    const reconciliation = await request(
      `/wallets/${playerWallet.id}/reconciliation`,
      { method: "POST" },
    );
    expect(reconciliation.status).toBe(201);
    expect(await reconciliation.json()).toMatchObject({
      storedBalance: { amount: "80.00", currency: "BRL" },
      calculatedBalance: { amount: "80.00", currency: "BRL" },
      difference: { amount: "0.00", currency: "BRL" },
      consistent: true,
      checkedEntries: 2,
    });
    const ledger = await request(`/wallets/${playerWallet.id}/ledger`);
    expect(((await ledger.json()) as { items: unknown[] }).items).toHaveLength(
      2,
    );
  });

  test("supports polymorphic payloads, gameId and retrieval endpoints", async () => {
    const playerId = `player-${randomUUID()}`;
    const walletResponse = await request("/wallets", {
      method: "POST",
      body: JSON.stringify({
        playerId,
        currency: "BRL",
        initialBalance: { amount: "250.00", currency: "BRL" },
      }),
    });
    expect(walletResponse.status).toBe(201);
    const walletData = (await walletResponse.json()) as Wallet;
    expect(walletData.balance.amount).toBe("250.00");

    const getWalletResponse = await request(`/wallets/${walletData.id}`);
    expect(getWalletResponse.status).toBe(200);
    expect(await getWalletResponse.json()).toMatchObject({
      id: walletData.id,
      playerId,
      balance: { amount: "250.00", currency: "BRL" },
    });

    const externalTransactionId = `bet-${randomUUID()}`;
    const txResponse = await request("/wagering/transactions", {
      method: "POST",
      headers: { "idempotency-key": `idem-${externalTransactionId}` },
      body: JSON.stringify({
        providerId: "integration-provider",
        externalTransactionId,
        walletId: walletData.id,
        playerId,
        money: { amount: "50.00", currency: "BRL" },
        kind: "BET",
        roundId: `round-${randomUUID()}`,
        gameId: "roulette-live",
      }),
    });
    expect(txResponse.status).toBe(200);
    const txData = (await txResponse.json()) as { id: string; gameId?: string };
    expect(txData.gameId).toBe("roulette-live");

    const getTxResponse = await request(
      `/wagering/transactions/${txData.id}`,
    );
    expect(getTxResponse.status).toBe(200);
    expect(await getTxResponse.json()).toMatchObject({
      id: txData.id,
      providerId: "integration-provider",
      externalTransactionId,
      walletId: walletData.id,
      playerId,
      gameId: "roulette-live",
      kind: "BET",
      status: "PROCESSED",
    });

    const getByProviderResponse = await request(
      `/providers/integration-provider/wagering/transactions/${externalTransactionId}`,
    );
    expect(getByProviderResponse.status).toBe(200);
    expect(await getByProviderResponse.json()).toMatchObject({
      id: txData.id,
      providerId: "integration-provider",
      externalTransactionId,
    });
  });

  test("returns proper HTTP error codes for duplicate, not found and invalid cursor", async () => {
    const playerId = `player-${randomUUID()}`;
    const wallet = await createWallet(playerId, "100.00");

    // 409 on duplicate wallet
    const dupWallet = await request("/wallets", {
      method: "POST",
      body: JSON.stringify({ playerId, currency: "BRL" }),
    });
    expect(dupWallet.status).toBe(409);

    // 404 on missing wallet
    const missingWallet = await request(`/wallets/${randomUUID()}`);
    expect(missingWallet.status).toBe(404);

    // 404 on missing transaction
    const missingTx = await request(`/wagering/transactions/${randomUUID()}`);
    expect(missingTx.status).toBe(404);

    // 404 on missing transaction by provider
    const missingProviderTx = await request(
      "/providers/unknown-prov/wagering/transactions/unknown-tx",
    );
    expect(missingProviderTx.status).toBe(404);

    // 400 on invalid ledger cursor
    const invalidCursor = await request(
      `/wallets/${wallet.id}/ledger?cursor=invalid_base64_json`,
    );
    expect(invalidCursor.status).toBe(400);
  });
});
