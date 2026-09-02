import { expect, test } from "bun:test";

test("provisions the short-load signals without inferring percentiles from gauges", async () => {
  const dashboard = await Bun.file(
    "docker/grafana/provisioning/dashboards/wagering-dashboard.json",
  ).json() as { panels: Array<{ targets?: Array<{ expr: string }> }> };
  const queries = dashboard.panels
    .flatMap((panel) => panel.targets ?? [])
    .map(({ expr }) => expr)
    .join("\n");

  for (const query of [
    "rate(wager_transactions_total[1m])",
    "histogram_quantile(0.50",
    "histogram_quantile(0.95",
    "histogram_quantile(0.99",
    'status=~"FAILED|ERROR"',
    'status="REJECTED"',
    "idempotency_replays_total",
    "outbox_pending",
    "outbox_lag_ms",
    "wallet_lock_duration_ms",
    "sqs_retries_total",
    "sqs_dlq_total",
    "reconciliation_divergences_total",
  ]) {
    expect(queries).toContain(query);
  }
});
