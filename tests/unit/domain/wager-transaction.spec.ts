import { describe, expect, test } from "bun:test";
import { DomainError } from "../../../src/domain/shared/domain-error";
import { WagerTransaction } from "../../../src/domain/wagering/wager-transaction";

describe("WagerTransaction Domain State Machine", () => {
  test("creates in PENDING status by default", () => {
    const tx = WagerTransaction.create();
    expect(tx.status).toBe("PENDING");
    expect(tx.isTerminal()).toBe(false);
  });

  test("allows valid transition from PENDING to PROCESSED", () => {
    const tx = WagerTransaction.create();
    tx.processed();
    expect(tx.status).toBe("PROCESSED");
    expect(tx.isTerminal()).toBe(true);
  });

  test("allows valid transition from PENDING to PENDING_REFERENCE", () => {
    const tx = WagerTransaction.create();
    tx.pendingReference();
    expect(tx.status).toBe("PENDING_REFERENCE");
    expect(tx.isTerminal()).toBe(false);
  });

  test("allows valid transition from PENDING_REFERENCE to PROCESSED", () => {
    const tx = WagerTransaction.create();
    tx.pendingReference();
    tx.processed();
    expect(tx.status).toBe("PROCESSED");
    expect(tx.isTerminal()).toBe(true);
  });

  test("allows valid transition from PENDING_REFERENCE to REJECTED", () => {
    const tx = WagerTransaction.create();
    tx.pendingReference();
    tx.rejected("REFERENCE_EXPIRED");
    expect(tx.status).toBe("REJECTED");
    expect(tx.failureCode).toBe("REFERENCE_EXPIRED");
    expect(tx.isTerminal()).toBe(true);
  });

  test("allows valid transition from PENDING to REJECTED with failure code", () => {
    const tx = WagerTransaction.create();
    tx.rejected("INSUFFICIENT_FUNDS");
    expect(tx.status).toBe("REJECTED");
    expect(tx.failureCode).toBe("INSUFFICIENT_FUNDS");
    expect(tx.isTerminal()).toBe(true);
  });

  test("allows valid transition from PENDING to FAILED with failure code", () => {
    const tx = WagerTransaction.create();
    tx.failed("PERMANENT_ERROR");
    expect(tx.status).toBe("FAILED");
    expect(tx.failureCode).toBe("PERMANENT_ERROR");
    expect(tx.isTerminal()).toBe(true);
  });

  describe("Terminal State Protection (Invariants)", () => {
    test("throws DomainError when attempting to transition PROCESSED transaction", () => {
      const tx = WagerTransaction.create();
      tx.processed();

      expect(() => tx.processed()).toThrow(DomainError);
      expect(() => tx.pendingReference()).toThrow(DomainError);
      expect(() => tx.rejected("ERR")).toThrow(DomainError);
      expect(() => tx.failed("ERR")).toThrow(DomainError);
    });

    test("throws DomainError when attempting to transition REJECTED transaction", () => {
      const tx = WagerTransaction.create();
      tx.rejected("INSUFFICIENT_FUNDS");

      expect(() => tx.processed()).toThrow(DomainError);
      expect(() => tx.pendingReference()).toThrow(DomainError);
      expect(() => tx.rejected("OTHER")).toThrow(DomainError);
      expect(() => tx.failed("OTHER")).toThrow(DomainError);
    });

    test("throws DomainError when attempting to transition FAILED transaction", () => {
      const tx = WagerTransaction.create();
      tx.failed("UNRECOVERABLE");

      expect(() => tx.processed()).toThrow(DomainError);
      expect(() => tx.pendingReference()).toThrow(DomainError);
      expect(() => tx.rejected("ERR")).toThrow(DomainError);
      expect(() => tx.failed("ERR")).toThrow(DomainError);
    });
  });
});
