import { describe, expect, test } from "bun:test";
import { createWalletSchema } from "../../../src/interfaces/http/wallets/wallets.controller";
import { transactionSchema } from "../../../src/interfaces/http/wagering/wagering.controller";

describe("DTO Compatibility & Contract Flexibility", () => {
  describe("createWalletSchema", () => {
    test("accepts string initialBalance", () => {
      const parsed = createWalletSchema.parse({
        playerId: "player-1",
        currency: "BRL",
        initialBalance: "150.00",
      });
      expect(parsed).toEqual({
        playerId: "player-1",
        currency: "BRL",
        initialBalance: "150.00",
      });
    });

    test("accepts nested object initialBalance", () => {
      const parsed = createWalletSchema.parse({
        playerId: "player-1",
        currency: "USD",
        initialBalance: { amount: "200.50", currency: "USD" },
      });
      expect(parsed).toEqual({
        playerId: "player-1",
        currency: "USD",
        initialBalance: "200.50",
      });
    });

    test("accepts omitted initialBalance", () => {
      const parsed = createWalletSchema.parse({
        playerId: "player-1",
        currency: "EUR",
      });
      expect(parsed).toEqual({
        playerId: "player-1",
        currency: "EUR",
        initialBalance: undefined,
      });
    });

    test("accepts initialBalance with amount and currency without root currency (challenge format)", () => {
      const parsed = createWalletSchema.parse({
        playerId: "player-1",
        initialBalance: { amount: "1000.00", currency: "BRL" },
      });
      expect(parsed).toEqual({
        playerId: "player-1",
        currency: "BRL",
        initialBalance: "1000.00",
      });
    });

    test("rejects when neither root currency nor initialBalance.currency is provided", () => {
      expect(() =>
        createWalletSchema.parse({
          playerId: "player-1",
          initialBalance: "150.00",
        }),
      ).toThrow();
    });

    test("rejects when root currency and initialBalance.currency mismatch", () => {
      expect(() =>
        createWalletSchema.parse({
          playerId: "player-1",
          currency: "USD",
          initialBalance: { amount: "1000.00", currency: "BRL" },
        }),
      ).toThrow();
    });
  });

  describe("transactionSchema", () => {
    test("accepts flattened amount and currency with gameId", () => {
      const parsed = transactionSchema.parse({
        providerId: "evo",
        externalTransactionId: "tx-1",
        walletId: "a0000000-0000-0000-0000-000000000001",
        playerId: "player-1",
        currency: "BRL",
        amount: "50.00",
        kind: "BET",
        roundId: "round-1",
        gameId: "roulette",
      });
      expect(parsed.amount).toBe("50.00");
      expect(parsed.currency).toBe("BRL");
      expect(parsed.gameId).toBe("roulette");
    });

    test("accepts nested money object with gameId", () => {
      const parsed = transactionSchema.parse({
        providerId: "evo",
        externalTransactionId: "tx-2",
        walletId: "a0000000-0000-0000-0000-000000000001",
        playerId: "player-1",
        money: {
          amount: "75.00",
          currency: "BRL",
        },
        kind: "BET",
        roundId: "round-2",
        gameId: "blackjack",
      });
      expect(parsed.amount).toBe("75.00");
      expect(parsed.currency).toBe("BRL");
      expect(parsed.gameId).toBe("blackjack");
    });

    test("rejects when both amount and money are missing", () => {
      expect(() =>
        transactionSchema.parse({
          providerId: "evo",
          externalTransactionId: "tx-3",
          walletId: "a0000000-0000-0000-0000-000000000001",
          playerId: "player-1",
          kind: "BET",
          roundId: "round-3",
        }),
      ).toThrow();
    });

    test("rejects REFUND without referenceExternalTransactionId", () => {
      expect(() =>
        transactionSchema.parse({
          providerId: "evo",
          externalTransactionId: "tx-4",
          walletId: "a0000000-0000-0000-0000-000000000001",
          playerId: "player-1",
          currency: "BRL",
          amount: "10.00",
          kind: "REFUND",
          roundId: "round-4",
        }),
      ).toThrow();
    });
  });
});
