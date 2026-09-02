import { expect, test } from "bun:test";
import { MessagingCoordinator } from "../../src/infrastructure/messaging/messaging-coordinator";

test("does not start background loops when the test-only worker switch is disabled", () => {
  const consumer = { pollOnce: () => Promise.resolve(), stop: () => undefined };
  const publisher = { publishBatch: () => Promise.resolve(), stop: () => undefined };
  const references = { processBatch: () => Promise.resolve() };
  const metrics = { increment: () => undefined };
  const config = { autostartWorkers: false };
  const coordinator = new MessagingCoordinator(
    consumer as never,
    publisher as never,
    references as never,
    metrics as never,
    config as never,
  );

  coordinator.onApplicationBootstrap();

  expect(coordinator.isRunning()).toBe(false);
});
