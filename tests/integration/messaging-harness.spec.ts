import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { MessagingHarness } from "../support/messaging-harness";

const integration = process.env.TEST_APP_URL ? test : test.skip;
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://wagering:wagering@postgres:5432/wagering";

let harness: MessagingHarness;

beforeAll(async () => {
  if (process.env.TEST_APP_URL) {
    harness = await MessagingHarness.create();
  }
});

afterAll(async () => {
  await harness?.close();
});

integration(
  "creates a test context with automatic workers disabled",
  async () => {
    expect(harness.isWorkerLoopRunning()).toBe(false);
  },
);

integration(
  "claims disjoint outbox batches and recovers an expired lease",
  async () => {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    const ids = Array.from({ length: 4 }, () => randomUUID());

    try {
      await harness.publishUntilIdle();

      for (const id of ids) {
        const expired = id === ids[0];
        await client.query(
          `INSERT INTO outbox_messages
             (id, event_type, payload, attempt_count, next_attempt_at,
              lease_until, lease_token, created_at)
           VALUES ($1, 'TestEvent.v1', $2::jsonb, 0, NOW(),
                   $3, $4, NOW())`,
          [
            id,
            JSON.stringify({ aggregateId: id, data: { walletId: id } }),
            expired ? new Date(Date.now() - 60_000) : null,
            expired ? randomUUID() : null,
          ],
        );
      }

      const publicationResults = await harness.publishConcurrently(2, 2);
      const publishedCount = publicationResults.reduce(
        (total, result) => total + result.published,
        0,
      );

      const result = await client.query(
        `SELECT id, published_at, lease_until, lease_token, attempt_count
         FROM outbox_messages WHERE id = ANY($1::uuid[])`,
        [ids],
      );
      expect(publishedCount).toBe(ids.length);
      expect(result.rows).toHaveLength(ids.length);
      expect(result.rows.every((row) => row.published_at !== null)).toBe(true);
      expect(result.rows.every((row) => row.lease_until === null)).toBe(true);
      expect(result.rows.every((row) => row.lease_token === null)).toBe(true);
      expect(result.rows.every((row) => row.attempt_count === 0)).toBe(true);
    } finally {
      await client.query(
        "DELETE FROM outbox_messages WHERE id = ANY($1::uuid[])",
        [ids],
      );
      await client.end();
    }
  },
);
