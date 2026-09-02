import { expect, test } from "bun:test";

test("exposes a reproducible short-load command and its evidence contract", async () => {
  const packageJson = await Bun.file("package.json").json() as {
    scripts: Record<string, string>;
  };
  const runner = await Bun.file("scripts/load/run-short-load.ts").text();
  const workflow = await Bun.file(".github/workflows/ci.yml").text();
  const compose = await Bun.file("compose.yaml").text();

  expect(packageJson.scripts["test:load"]).toBe(
    "bun run scripts/load/run-short-load.ts",
  );

  for (const contract of [
    "LOAD_WARMUP_SECONDS",
    "LOAD_DURATION_SECONDS",
    "LOAD_CONCURRENCY",
    "runId",
    "outbox_pending",
    "outbox_lag_ms",
    "reconciliation",
    "wallet_ledger_entries",
    "wager_transactions",
    "inbox_messages",
    "outbox_events",
    "technicalFailures",
    "businessRejections",
    "conflicts",
  ]) {
    expect(runner).toContain(contract);
  }

  expect(workflow).toContain("load-test:");
  expect(workflow).toContain("bun run test:load");
  expect(workflow).toContain("up -d --scale app=3 --wait app prometheus grafana");
  expect(compose).toContain("http://127.0.0.1:3000/health/ready");
  expect(workflow).toContain("actions/upload-artifact@v4");
  expect(workflow).toContain("artifacts/load-report");
  expect(runner).toContain("Commit: ${report.commit}");
  expect(runner).toContain("Exit code: ${report.exitCode}");
  expect(runner).toContain("Commands:\\n\\n${commands}");
});
