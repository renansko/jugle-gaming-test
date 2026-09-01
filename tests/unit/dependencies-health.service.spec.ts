import { expect, test } from "bun:test";
import { DependenciesHealthService } from "../../src/infrastructure/health/dependencies-health.service";
import { AppConfig } from "../../src/infrastructure/config/app-config";

const unavailableDependencies = new AppConfig(
  "test",
  3000,
  "postgresql://wagering:wagering@127.0.0.1:1/wagering",
  "http://127.0.0.1:1",
  "us-east-1",
  "test",
  "test",
  "http://127.0.0.1:1/000000000000/wager-transactions.fifo",
  "http://127.0.0.1:1/000000000000/wager-transactions-dlq.fifo",
  "http://127.0.0.1:1/000000000000/wager-events.fifo",
);

test("reports both dependencies down when PostgreSQL and SQS cannot be reached", async () => {
  const health = new DependenciesHealthService(unavailableDependencies);

  await expect(health.check()).resolves.toEqual({
    database: "down",
    sqs: "down",
  });
});
