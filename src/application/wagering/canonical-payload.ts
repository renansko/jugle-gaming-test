import { createHash } from "node:crypto";

export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

export interface CanonicalWagerInput {
  amount: string;
  currency: string;
  externalTransactionId: string;
  gameId?: string;
  kind: string;
  playerId: string;
  providerId: string;
  referenceExternalTransactionId?: string;
  roundId: string;
  walletId: string;
}

/** Produces a stable JSON representation before hashing an idempotent request. */
export function canonicalPayloadHash(value: CanonicalValue): string {
  const canonicalString = canonicalize(value);
  return createHash("sha256").update(canonicalString, "utf8").digest("hex");
}

export function canonicalWagerPayloadHash(input: CanonicalWagerInput): string {
  return canonicalPayloadHash({
    amount: input.amount,
    currency: input.currency,
    externalTransactionId: input.externalTransactionId,
    gameId: input.gameId ?? null,
    kind: input.kind,
    playerId: input.playerId,
    providerId: input.providerId,
    referenceExternalTransactionId:
      input.referenceExternalTransactionId ?? null,
    roundId: input.roundId,
    walletId: input.walletId,
  });
}

export function canonicalize(value: CanonicalValue): string {
  if (value === null || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const serializedItems = value.map((item) => canonicalize(item)).join(",");
    return `[${serializedItems}]`;
  }

  const sortedKeys = Object.entries(value).sort(([keyA], [keyB]) =>
    keyA.localeCompare(keyB),
  );
  const serializedEntries = sortedKeys.map(([key, nestedValue]) => {
    return `${JSON.stringify(key)}:${canonicalize(nestedValue)}`;
  });

  return `{${serializedEntries.join(",")}}`;
}
