import { createHash } from "node:crypto";

export type CanonicalValue = null | boolean | number | string | CanonicalValue[] | { [key: string]: CanonicalValue };

/** Produces a stable JSON representation before hashing an idempotent request. */
export function canonicalPayloadHash(value: CanonicalValue): string {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

export function canonicalize(value: CanonicalValue): string {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(",")}}`;
}
