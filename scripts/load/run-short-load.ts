import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, freemem, platform, release, totalmem } from "node:os";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { type LoadSample, summarizeLoadSamples } from "./load-report";

const baseUrl = process.env.TEST_APP_URL ?? "http://localhost:3000";
const databaseUrl = process.env.DATABASE_URL ??
  "postgresql://wagering:wagering@localhost:5432/wagering";
const warmupSeconds = positiveNumber("LOAD_WARMUP_SECONDS", 2);
const durationSeconds = positiveNumber("LOAD_DURATION_SECONDS", 10);
const concurrency = positiveNumber("LOAD_CONCURRENCY", 8);
const runId = `load-${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
const startedAt = new Date();

type Wallet = { id: string };
type OperationContext = { wallet: Wallet; playerId: string; sequence: number };

interface DatabaseEvidence {
  wallet_ledger_entries: number;
  wager_transactions: number;
  inbox_messages: number;
  outbox_events: number;
  outbox_pending: number;
  outbox_lag_ms: number;
  processed: number;
  rejected: number;
}

function positiveNumber(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
  return value;
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
}

async function createWallet(playerId: string): Promise<Wallet> {
  const response = await request("/wallets", {
    method: "POST",
    body: JSON.stringify({ playerId, currency: "BRL", initialBalance: "1000000.00" }),
  });
  if (!response.ok) throw new Error(`wallet setup failed: ${response.status}`);
  return response.json() as Promise<Wallet>;
}

function wagerBody(context: OperationContext, amount: string) {
  return {
    providerId: runId,
    externalTransactionId: `${runId}-${context.sequence}`,
    walletId: context.wallet.id,
    playerId: context.playerId,
    currency: "BRL",
    amount,
    kind: "BET",
    roundId: `${runId}-round-${context.sequence}`,
  };
}

async function performOperation(context: OperationContext): Promise<LoadSample> {
  const started = performance.now();
  const kind = context.sequence % 10;
  const amount = kind === 7 ? "999999999.00" : "0.01";
  const idempotencyKey = `${runId}-idem-${context.sequence}`;
  const body = wagerBody(context, amount);

  try {
    const first = await postWager(idempotencyKey, body);
    const response = await repeatedResponse(kind, idempotencyKey, body, first);
    return { durationMs: performance.now() - started, status: response.status };
  } catch (error) {
    return { durationMs: performance.now() - started, error: String(error) };
  }
}

async function postWager(idempotencyKey: string, body: object): Promise<Response> {
  return request("/wagering/transactions", {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey },
    body: JSON.stringify(body),
  });
}

async function repeatedResponse(
  kind: number,
  idempotencyKey: string,
  body: ReturnType<typeof wagerBody>,
  first: Response,
): Promise<Response> {
  if (kind === 8) return postWager(idempotencyKey, body);
  if (kind === 9) return postWager(idempotencyKey, { ...body, amount: "0.02" });
  return first;
}

async function runPhase(seconds: number, wallets: readonly Wallet[], collect: boolean) {
  const deadline = performance.now() + seconds * 1_000;
  const samples: LoadSample[] = [];
  let sequence = 0;

  async function worker(index: number): Promise<void> {
    while (performance.now() < deadline) {
      const current = sequence++;
      const sample = await performOperation({
        wallet: wallets[index % wallets.length] as Wallet,
        playerId: `${runId}-player-${index % wallets.length}`,
        sequence: current,
      });
      if (collect) samples.push(sample);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, (_, index) => worker(index)));
  return samples;
}

async function monitorOutbox(client: Client, seconds: number): Promise<number> {
  const deadline = Date.now() + seconds * 1_000;
  let peak = 0;
  while (Date.now() < deadline) {
    peak = Math.max(peak, (await databaseEvidence(client)).outbox_pending);
    await Bun.sleep(250);
  }
  return peak;
}

async function waitForOutbox(client: Client, observedPeak: number): Promise<{ peak: number; final: number; lagMs: number }> {
  let peak = observedPeak;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const evidence = await databaseEvidence(client);
    peak = Math.max(peak, evidence.outbox_pending);
    if (evidence.outbox_pending === 0) return { peak, final: 0, lagMs: 0 };
    await Bun.sleep(250);
  }
  const evidence = await databaseEvidence(client);
  return { peak, final: evidence.outbox_pending, lagMs: evidence.outbox_lag_ms };
}

async function databaseEvidence(client: Client): Promise<DatabaseEvidence> {
  const result = await client.query(`
    with run_transactions as (
      select id, wallet_id, status from wager_transactions where provider_id = $1
    ), run_wallets as (
      select id from wallets where player_id like $2
    )
    select
      (select count(*) from wallet_ledger_entries where wallet_id in (select id from run_wallets))::int as wallet_ledger_entries,
      (select count(*) from run_transactions)::int as wager_transactions,
      (select count(*) from inbox_messages)::int as inbox_messages,
      (select count(*) from outbox_messages where payload->>'aggregateId' in (select id::text from run_transactions)
        or payload->'data'->>'transactionId' in (select id::text from run_transactions))::int as outbox_events,
      (select count(*) from outbox_messages where published_at is null)::int as outbox_pending,
      coalesce((select extract(epoch from (now() - min(created_at))) * 1000 from outbox_messages where published_at is null), 0)::int as outbox_lag_ms,
      (select count(*) from run_transactions where status = 'PROCESSED')::int as processed,
      (select count(*) from run_transactions where status = 'REJECTED')::int as rejected
  `, [runId, `${runId}-player-%`]);
  return result.rows[0] as DatabaseEvidence;
}

function verifyExpectedCounts(database: DatabaseEvidence, walletCount: number): void {
  const expectedLedger = walletCount + database.processed;
  const expectedOutbox = database.processed * 2 + database.rejected;
  const expectedTransactions = database.processed + database.rejected;
  if (database.wallet_ledger_entries !== expectedLedger) throw new Error("unexpected wallet_ledger_entries count");
  if (database.outbox_events !== expectedOutbox) throw new Error("unexpected outbox_events count");
  if (database.wager_transactions !== expectedTransactions) throw new Error("unexpected wager_transactions count");
  if (database.inbox_messages !== 0) throw new Error("HTTP load unexpectedly created inbox_messages");
}

async function verifyReconciliation(wallets: readonly Wallet[]): Promise<number> {
  let checked = 0;
  for (const wallet of wallets) {
    const response = await request(`/wallets/${wallet.id}/reconciliation`, { method: "POST" });
    const result = await response.json() as { consistent?: boolean };
    if (!response.ok || result.consistent !== true) throw new Error(`reconciliation failed for ${wallet.id}`);
    checked += 1;
  }
  return checked;
}

function commandVersion(command: string, args: string[]): string {
  try {
    const result = Bun.spawnSync([command, ...args]);
    return result.exitCode === 0 ? result.stdout.toString().trim() : "not available in runner";
  } catch {
    return "not available in runner";
  }
}

function markdown(report: Record<string, unknown>): string {
  const summary = report.summary as ReturnType<typeof summarizeLoadSamples>;
  const outbox = report.outbox as { peak: number; final: number; lagMs: number };
  const commands = (report.commands as string[])
    .map((command) => `- \`${command}\``)
    .join("\n");

  return `# Short load report\n\nCommit: ${report.commit}  \nExit code: ${report.exitCode}\n\nCommands:\n\n${commands}\n\n## Environment\n\n\`\`\`json\n${JSON.stringify(report.environment, null, 2)}\n\`\`\`\n\n## Methodology\n\nWarm-up: ${warmupSeconds}s. Measurement: ${durationSeconds}s. Concurrency: ${concurrency}. Isolated mass: \`${runId}\`. Operation mix: successful BETs, insufficient-funds rejections, exact replays and changed-payload idempotency conflicts. Termination: fixed duration; technical failures or invariant violations produce a non-zero exit. No minimum RPS gate is used.\n\n## Client results\n\n| requests | req/s | p50 ms | p95 ms | p99 ms | success | business rejection | conflict | technical failure |\n|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n| ${summary.requests} | ${report.throughputRps} | ${summary.latencyMs.p50} | ${summary.latencyMs.p95} | ${summary.latencyMs.p99} | ${summary.successful} | ${summary.businessRejections} | ${summary.conflicts} | ${summary.technicalFailures} |\n\n## Internal signals and invariants\n\nOutbox peak pending: ${outbox.peak}; final pending: ${outbox.final}; final lag: ${outbox.lagMs}ms.\n\n\`\`\`json\n${JSON.stringify(report.database, null, 2)}\n\`\`\`\n\nClient latency/throughput and application Prometheus series are distinct observations. The provisioned Grafana dashboard displays the internal series.\n`;
}

async function main(): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  let exitCode = 0;
  try {
    const wallets = await Promise.all(Array.from({ length: concurrency }, (_, index) => createWallet(`${runId}-player-${index}`)));
    await runPhase(warmupSeconds, wallets, false);
    const [samples, outboxPeak] = await Promise.all([
      runPhase(durationSeconds, wallets, true),
      monitorOutbox(client, durationSeconds),
    ]);
    const summary = summarizeLoadSamples(samples);
    const outbox = await waitForOutbox(client, outboxPeak);
    const reconciliation = await verifyReconciliation(wallets);
    const database = await databaseEvidence(client);
    verifyExpectedCounts(database, wallets.length);
    exitCode = summary.technicalFailures > 0 || outbox.final > 0 ? 1 : 0;
    const report = {
      runId,
      commit: process.env.GITHUB_SHA ?? commandVersion("git", ["rev-parse", "HEAD"]),
      commands: [
        "docker compose -f compose.yaml -f compose.hardening.yaml -f compose.load.yaml up -d --build --wait postgres localstack",
        "docker compose -f compose.yaml -f compose.hardening.yaml -f compose.load.yaml run --rm app bun run migration:up",
        "docker compose -f compose.yaml -f compose.hardening.yaml -f compose.load.yaml up -d --scale app=3 app prometheus grafana",
        "docker compose -f compose.yaml -f compose.hardening.yaml -f compose.load.yaml run --rm --no-deps test bun run test:load",
      ],
      environment: {
        os: `${platform()} ${release()}`,
        cpu: `${cpus().length} x ${cpus()[0]?.model ?? "unknown"}`,
        memory: { totalBytes: totalmem(), freeBytes: freemem() },
        Bun: Bun.version,
        Docker: process.env.LOAD_DOCKER_VERSION ?? "reported by CI host",
        PostgreSQL: (await client.query("select version() as version")).rows[0].version,
        LocalStack: process.env.LOAD_LOCALSTACK_VERSION ?? "3.8.1",
      },
      methodology: { warmupSeconds, durationSeconds, concurrency, operationMix: "70/10/10/10 target", isolatedMass: runId, termination: "fixed duration" },
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationSeconds,
      throughputRps: Number((summary.requests / durationSeconds).toFixed(2)),
      summary,
      outbox,
      reconciliation: { walletsChecked: reconciliation, consistent: true },
      database,
      exitCode,
    };
    mkdirSync("artifacts", { recursive: true });
    writeFileSync("artifacts/load-report.json", `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync("artifacts/load-report.md", markdown(report));
    console.log(markdown(report));
  } finally {
    await client.end();
  }
  process.exitCode = exitCode;
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
