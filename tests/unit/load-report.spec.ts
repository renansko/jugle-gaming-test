import { describe, expect, test } from "bun:test";
import { summarizeLoadSamples } from "../../scripts/load/load-report";

describe("short load report", () => {
  test("reports client percentiles and separates outcome categories", () => {
    const report = summarizeLoadSamples([
      { durationMs: 10, status: 200 },
      { durationMs: 20, status: 422 },
      { durationMs: 30, status: 409 },
      { durationMs: 40, status: 503 },
      { durationMs: 50, error: "connection reset" },
    ]);

    expect(report).toEqual({
      requests: 5,
      successful: 1,
      businessRejections: 1,
      conflicts: 1,
      technicalFailures: 2,
      latencyMs: { p50: 30, p95: 50, p99: 50 },
    });
  });
});
