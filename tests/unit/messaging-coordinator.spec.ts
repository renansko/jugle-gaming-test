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

test("delegates graceful shutdown to consumer.shutdown with configured grace period", async () => {
  let shutdownGracePeriodPassed: number | undefined;
  let publisherStopped = false;

  const consumer = {
    pollOnce: () => Promise.resolve(),
    shutdown: (gracePeriodMs?: number) => {
      shutdownGracePeriodPassed = gracePeriodMs;
      return Promise.resolve();
    },
  };
  const publisher = {
    publishBatch: () => Promise.resolve(),
    stop: () => {
      publisherStopped = true;
    },
  };
  const references = { processBatch: () => Promise.resolve() };
  const metrics = { increment: () => undefined };
  const config = { autostartWorkers: false, shutdownGracePeriodMs: 4000 };

  const coordinator = new MessagingCoordinator(
    consumer as never,
    publisher as never,
    references as never,
    metrics as never,
    config as never,
  );

  await coordinator.beforeApplicationShutdown();

  expect(shutdownGracePeriodPassed).toBe(4000);
  expect(publisherStopped).toBe(true);
});

