import { describe, expect, test } from "bun:test";
import { OperationalMetrics } from "../../src/infrastructure/observability/operational-metrics";
import { OpenTelemetryBridge } from "../../src/infrastructure/observability/opentelemetry";

describe("OpenTelemetry & Observability Bridge", () => {
  test("registers metrics with OpenTelemetry and exports Prometheus exposition format", () => {
    const otel = new OpenTelemetryBridge("junglegaming-processor");
    const metrics = new OperationalMetrics(otel);

    metrics.increment("wager_transactions_total", { kind: "BET", status: "PROCESSED" });
    metrics.increment("wager_transactions_total", { kind: "BET", status: "PROCESSED" });
    metrics.increment("wager_transactions_total", { kind: "BET", status: "REJECTED" });
    metrics.set("wallet_lock_duration_ms", 12.5);
    metrics.observe("wager_processing_latency_ms", 45.2, { channel: "http" });

    const prometheusText = metrics.toPrometheusFormat();

    expect(prometheusText).toContain("# HELP wager_transactions_total");
    expect(prometheusText).toContain("# TYPE wager_transactions_total counter");
    expect(prometheusText).toContain('wager_transactions_total{kind="BET",status="PROCESSED"} 2');
    expect(prometheusText).toContain('wager_transactions_total{kind="BET",status="REJECTED"} 1');
    expect(prometheusText).toContain('wallet_lock_duration_ms 12.5');
    expect(prometheusText).toContain('wager_processing_latency_ms{channel="http"} 45.2');
  });

  test("creates trace spans and executes wrapped function preserving result", async () => {
    const otel = new OpenTelemetryBridge("junglegaming-processor");

    const result = await otel.withSpan("test_operation", { "test.tag": "value" }, async (span) => {
      expect(span).toBeDefined();
      return 42;
    });

    expect(result).toBe(42);
  });
});
