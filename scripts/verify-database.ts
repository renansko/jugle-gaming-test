import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const expectedIndexes = [
  "outbox_messages_pending_index",
  "wager_transactions_pending_reference_index",
  "wallet_ledger_entries_wallet_created_id_index",
  "wager_transactions_provider_external_index",
];

async function main(): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const indexes = await client.query<{ indexname: string }>(
      "select indexname from pg_indexes where schemaname = 'public'",
    );
    const present = new Set(indexes.rows.map((row) => row.indexname));
    const missing = expectedIndexes.filter((index) => !present.has(index));
    if (missing.length)
      throw new Error(`Missing critical indexes: ${missing.join(", ")}`);

    const plans = await Promise.all([
      client.query(
        "explain (costs false) select id from outbox_messages where published_at is null and next_attempt_at <= now() order by created_at limit 10",
      ),
      client.query(
        "explain (costs false) select id from wager_transactions where status = 'PENDING_REFERENCE' and next_reference_attempt_at <= now() order by next_reference_attempt_at limit 20",
      ),
      client.query(
        "explain (costs false) select id from wallet_ledger_entries where wallet_id = '00000000-0000-0000-0000-000000000000'::uuid order by created_at desc, id desc limit 51",
      ),
    ]);
    for (const [position, plan] of plans.entries())
      console.log(
        `plan-${position + 1}:\n${plan.rows.map((row) => Object.values(row).join(" ")).join("\n")}`,
      );
    console.log(`verified-indexes: ${expectedIndexes.join(", ")}`);
  } finally {
    await client.end();
  }
}

void main();
