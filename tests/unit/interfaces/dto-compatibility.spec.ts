import { describe, expect, test } from "bun:test";
import { z } from "zod";

const initialBalanceSchema = z.union([
  z.string(),
  z
    .object({
      amount: z.string(),
      currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    })
    .strict(),
]);

const createWalletSchema = z
  .object({
    playerId: z.string().min(1).max(128),
    currency: z.string().regex(/^[A-Z]{3}$/),
    initialBalance: initialBalanceSchema.optional(),
  })
  .strict()
  .transform((data) => {
    let initialBalance: string | undefined;
    if (typeof data.initialBalance === "string") {
      initialBalance = data.initialBalance;
    } else if (data.initialBalance && typeof data.initialBalance === "object") {
      initialBalance = data.initialBalance.amount;
    }
    return {
      playerId: data.playerId,
      currency: data.currency,
      initialBalance,
    };
  });

const transactionSchema = z
  .object({
    providerId: z.string().min(1).max(128),
    externalTransactionId: z.string().min(1).max(255),
    walletId: z.string().uuid(),
    playerId: z.string().min(1).max(128),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    amount: z.string().optional(),
    money: z
      .object({
        amount: z.string(),
        currency: z.string().regex(/^[A-Z]{3}$/),
      })
      .strict()
      .optional(),
    kind: z.enum(["BET", "WIN", "LOSS", "REFUND", "ROLLBACK"]),
    roundId: z.string().min(1).max(255),
    gameId: z.string().min(1).max(255).optional(),
    referenceExternalTransactionId: z.string().min(1).max(255).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const hasMoney = Boolean(value.money);
    const hasAmountCurrency = Boolean(value.amount && value.currency);

    if (!hasMoney && !hasAmountCurrency) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Either amount and currency or money object is required",
        path: ["amount"],
      });
    }

    if (
      ["REFUND", "ROLLBACK"].includes(value.kind) &&
      !value.referenceExternalTransactionId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A reference transaction is required for reversals",
        path: ["referenceExternalTransactionId"],
      });
    }
  })
  .transform((value) => {
    const amount = value.money ? value.money.amount : (value.amount as string);
    const currency = value.money
      ? value.money.currency
      : (value.currency as string);

    return {
      providerId: value.providerId,
      externalTransactionId: value.externalTransactionId,
      walletId: value.walletId,
      playerId: value.playerId,
      currency,
      amount,
      kind: value.kind,
      roundId: value.roundId,
      gameId: value.gameId,
      referenceExternalTransactionId: value.referenceExternalTransactionId,
    };
  });

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
