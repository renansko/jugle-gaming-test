import { expect, test } from "bun:test";
import { loadConfig } from "../../src/infrastructure/config/app-config";

const validEnvironment = {
  DATABASE_URL: "postgresql://user:password@localhost:5432/database",
  SQS_ENDPOINT: "http://localhost:4566",
  AWS_ACCESS_KEY_ID: "test",
  AWS_SECRET_ACCESS_KEY: "test",
  SQS_WAGER_QUEUE_URL:
    "http://localhost:4566/000000000000/wager-transactions.fifo",
  SQS_WAGER_DLQ_URL:
    "http://localhost:4566/000000000000/wager-transactions-dlq.fifo",
  SQS_EVENT_QUEUE_URL: "http://localhost:4566/000000000000/wager-events.fifo",
};

test("loads a complete configuration", () => {
  const config = loadConfig(validEnvironment);
  expect(config.port).toBe(3000);
  expect(config.awsRegion).toBe("us-east-1");
});

test("reports only invalid configuration keys without exposing values", () => {
  expect(() =>
    loadConfig({ ...validEnvironment, AWS_SECRET_ACCESS_KEY: "" }),
  ).toThrow("AWS_SECRET_ACCESS_KEY");
});

test("disables automatic workers by default in the test environment", () => {
  const config = loadConfig({ ...validEnvironment, NODE_ENV: "test" });

  expect(config.autostartWorkers).toBe(false);
});

test("rejects the test-only worker switch outside the test environment", () => {
  expect(() =>
    loadConfig({
      ...validEnvironment,
      NODE_ENV: "development",
      TEST_WORKERS_AUTOSTART: "false",
    }),
  ).toThrow("TEST_WORKERS_AUTOSTART");
});

test("loads default shutdown grace period of 5000ms when not specified", () => {
  const config = loadConfig(validEnvironment);
  expect(config.shutdownGracePeriodMs).toBe(5000);
});

test("loads custom shutdown grace period from environment", () => {
  const config = loadConfig({
    ...validEnvironment,
    SHUTDOWN_GRACE_PERIOD_MS: "2500",
  });
  expect(config.shutdownGracePeriodMs).toBe(2500);
});

test("rejects invalid shutdown grace period", () => {
  expect(() =>
    loadConfig({
      ...validEnvironment,
      SHUTDOWN_GRACE_PERIOD_MS: "invalid",
    }),
  ).toThrow("SHUTDOWN_GRACE_PERIOD_MS");
});

