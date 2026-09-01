import { describe, expect, test } from "bun:test";
import {
  canonicalPayloadHash,
  canonicalize,
} from "../../../src/application/wagering/canonical-payload";

describe("canonical payload", () => {
  test("orders nested object keys without changing array order", () => {
    const first = {
      provider: "acme",
      money: { currency: "BRL", amount: "10.00" },
      tags: ["a", "b"],
    };
    const second = {
      tags: ["a", "b"],
      money: { amount: "10.00", currency: "BRL" },
      provider: "acme",
    };
    expect(canonicalize(first)).toBe(canonicalize(second));
    expect(canonicalPayloadHash(first)).toBe(canonicalPayloadHash(second));
  });

  test("distinguishes a material payload change", () => {
    expect(canonicalPayloadHash({ amount: "10.00" })).not.toBe(
      canonicalPayloadHash({ amount: "10.01" }),
    );
  });
});
