import { expect, test } from "bun:test";

const appUrl = process.env.TEST_APP_URL;
const integration = appUrl ? test : test.skip;

integration("liveness and readiness use the running application with PostgreSQL and SQS", async () => {
  const [live, ready] = await Promise.all([
    fetch(`${appUrl}/health/live`),
    fetch(`${appUrl}/health/ready`),
  ]);

  expect(live.status).toBe(200);
  expect(await live.json()).toEqual({ status: "ok" });
  expect(ready.status).toBe(200);
  expect(await ready.json()).toEqual({
    status: "ok",
    dependencies: { database: "up", sqs: "up" },
  });
});
