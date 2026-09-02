import { describe, expect, test } from "bun:test";
import { OperationalMetrics } from "../../src/infrastructure/observability/operational-metrics";

describe("OperationalMetrics", () => {
  test("exposes required operational series before the first observation", () => {
    const metrics = new OperationalMetrics().snapshot();

    expect(metrics.get("wager_transactions_total{}")).toBe(0);
    expect(metrics.get("wallet_lock_duration_ms{}")).toBe(0);
    expect(metrics.get("wager_processing_latency_ms{}")).toBe(0);
    expect(metrics.get("outbox_pending{}")).toBe(0);
    expect(metrics.get("outbox_lag_ms{}")).toBe(0);
  });
});
