import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

const baseUrl = process.env.TEST_APP_URL;
const concurrency = baseUrl ? describe : describe.skip;

type Wallet = { id: string };
type Transaction = { id: string; status: string; idempotentReplay: boolean };

async function request(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
}

async function wallet(
  balance = "100.00",
): Promise<{ wallet: Wallet; playerId: string }> {
  const playerId = `concurrency-${randomUUID()}`;
  const response = await request("/wallets", {
    method: "POST",
    body: JSON.stringify({
      playerId,
      currency: "BRL",
      initialBalance: balance,
    }),
  });
  expect(response.status).toBe(201);
  return { wallet: (await response.json()) as Wallet, playerId };
}

function bet(
  target: Wallet,
  playerId: string,
  externalTransactionId: string,
  idempotencyKey = `idem-${externalTransactionId}`,
): RequestInit {
  return {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey },
    body: JSON.stringify({
      providerId: "concurrency-provider",
      externalTransactionId,
      walletId: target.id,
      playerId,
      currency: "BRL",
      amount: "80.00",
      kind: "BET",
      roundId: `round-${externalTransactionId}`,
    }),
  };
}

concurrency("three-instance concurrency", () => {
  test("50 simultaneous retries produce exactly one debit", async () => {
    const { wallet: target, playerId } = await wallet();
    const externalTransactionId = `same-${randomUUID()}`;
    const idempotencyKey = `idem-${randomUUID()}`;
    const responses = await Promise.all(
      Array.from({ length: 50 }, () =>
        request(
          "/wagering/transactions",
          bet(target, playerId, externalTransactionId, idempotencyKey),
        ),
      ),
    );
    expect(responses.every((response) => response.status === 200)).toBe(true);
    const payloads = await Promise.all(
      responses.map((response) => response.json() as Promise<Transaction>),
    );
    expect(new Set(payloads.map((payload) => payload.id)).size).toBe(1);
    expect(
      payloads.filter((payload) => !payload.idempotentReplay),
    ).toHaveLength(1);
    const reconciliation = await request(
      `/wallets/${target.id}/reconciliation`,
      { method: "POST" },
    );
    expect(await reconciliation.json()).toMatchObject({
      storedBalance: { amount: "20.00", currency: "BRL" },
      calculatedBalance: { amount: "20.00", currency: "BRL" },
      consistent: true,
      checkedEntries: 2,
    });
  });

  test("two debits of 80 against 100 leave one processed and one rejected", async () => {
    const { wallet: target, playerId } = await wallet();
    const responses = await Promise.all([
      request(
        "/wagering/transactions",
        bet(target, playerId, `first-${randomUUID()}`),
      ),
      request(
        "/wagering/transactions",
        bet(target, playerId, `second-${randomUUID()}`),
      ),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 422,
    ]);
    const reconciliation = await request(
      `/wallets/${target.id}/reconciliation`,
      { method: "POST" },
    );
    expect(await reconciliation.json()).toMatchObject({
      storedBalance: { amount: "20.00", currency: "BRL" },
      calculatedBalance: { amount: "20.00", currency: "BRL" },
      consistent: true,
      checkedEntries: 2,
    });
  });

  test("two simultaneous reversals of same type produce exactly one financial reversal", async () => {
    const { wallet: target, playerId } = await wallet("100.00");
    const betId = `bet-orig-${randomUUID()}`;
    const roundId = `round-${betId}`;

    // 1. Submit original BET of 40.00 -> balance becomes 60.00
    const betRes = await request("/wagering/transactions", {
      method: "POST",
      headers: { "idempotency-key": `idem-${betId}` },
      body: JSON.stringify({
        providerId: "concurrency-provider",
        externalTransactionId: betId,
        walletId: target.id,
        playerId,
        currency: "BRL",
        amount: "40.00",
        kind: "BET",
        roundId,
      }),
    });
    expect(betRes.status).toBe(200);

    // 2. Submit two concurrent refunds of 40.00 referencing the same BET
    const ref1 = `ref-1-${randomUUID()}`;
    const ref2 = `ref-2-${randomUUID()}`;

    const responses = await Promise.all([
      request("/wagering/transactions", {
        method: "POST",
        headers: { "idempotency-key": `idem-${ref1}` },
        body: JSON.stringify({
          providerId: "concurrency-provider",
          externalTransactionId: ref1,
          walletId: target.id,
          playerId,
          currency: "BRL",
          amount: "40.00",
          kind: "REFUND",
          roundId,
          referenceExternalTransactionId: betId,
        }),
      }),
      request("/wagering/transactions", {
        method: "POST",
        headers: { "idempotency-key": `idem-${ref2}` },
        body: JSON.stringify({
          providerId: "concurrency-provider",
          externalTransactionId: ref2,
          walletId: target.id,
          playerId,
          currency: "BRL",
          amount: "40.00",
          kind: "REFUND",
          roundId,
          referenceExternalTransactionId: betId,
        }),
      }),
    ]);

    expect(responses.map((r) => r.status).sort()).toEqual([200, 422]);

    const errorPayload = (await responses.find((r) => r.status === 422)?.json()) as {
      failureCode?: string;
      code?: string;
    };
    expect(errorPayload.failureCode ?? errorPayload.code).toBe(
      "REFERENCE_ALREADY_REVERSED",
    );

    // 3. Reconcile wallet: 100 (initial) - 40 (bet) + 40 (refund) = 100
    const reconciliation = await request(
      `/wallets/${target.id}/reconciliation`,
      { method: "POST" },
    );
    expect(await reconciliation.json()).toMatchObject({
      storedBalance: { amount: "100.00", currency: "BRL" },
      calculatedBalance: { amount: "100.00", currency: "BRL" },
      consistent: true,
      checkedEntries: 3,
    });
  });
});
