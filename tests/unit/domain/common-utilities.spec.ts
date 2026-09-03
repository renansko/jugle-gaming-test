import { describe, expect, test } from "bun:test";
import { SystemClock, SettableClock } from "../../../src/domain/common/clock";
import {
  CryptoIdGenerator,
  DeterministicIdGenerator,
} from "../../../src/domain/common/id-generator";
import {
  DefaultBackoffPolicy,
  ZeroBackoffPolicy,
} from "../../../src/domain/common/backoff-policy";
import { ConcurrencyBarrier } from "../../support/concurrency-barrier";

describe("Domain Common Utilities", () => {
  describe("Clock", () => {
    test("SystemClock returns current system time", () => {
      const clock = new SystemClock();
      const before = Date.now();
      const now = clock.now();
      const after = Date.now();

      expect(now).toBeInstanceOf(Date);
      expect(now.getTime()).toBeGreaterThanOrEqual(before);
      expect(now.getTime()).toBeLessThanOrEqual(after);
      expect(clock.nowMs()).toBeGreaterThanOrEqual(before);
    });

    test("SettableClock allows controlling time deterministically in tests", () => {
      const fixedDate = new Date("2026-09-01T12:00:00.000Z");
      const clock = new SettableClock(fixedDate);

      expect(clock.now()).toEqual(fixedDate);
      expect(clock.nowMs()).toBe(fixedDate.getTime());

      clock.advanceMs(5000);
      expect(clock.now().toISOString()).toBe("2026-09-01T12:00:05.000Z");
      expect(clock.nowMs()).toBe(fixedDate.getTime() + 5000);

      const nextDate = new Date("2026-10-01T00:00:00.000Z");
      clock.setTime(nextDate);
      expect(clock.now()).toEqual(nextDate);
    });
  });

  describe("IdGenerator", () => {
    test("CryptoIdGenerator generates valid UUIDs", () => {
      const generator = new CryptoIdGenerator();
      const id1 = generator.generate();
      const id2 = generator.generate();

      expect(id1).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(id2).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(id1).not.toBe(id2);
    });

    test("DeterministicIdGenerator yields sequential or provided IDs in tests", () => {
      const generator = new DeterministicIdGenerator(["custom-1", "custom-2"]);

      expect(generator.generate()).toBe("custom-1");
      expect(generator.generate()).toBe("custom-2");
      expect(generator.generate()).toBe("det-id-3");
      expect(generator.generate()).toBe("det-id-4");
    });
  });

  describe("BackoffPolicy", () => {
    test("DefaultBackoffPolicy computes exponential delay with jitter and delays asynchronously", async () => {
      const policy = new DefaultBackoffPolicy();
      const delayAttempt0 = policy.computeDelayMs(0, 20, 10);
      expect(delayAttempt0).toBeGreaterThanOrEqual(20);
      expect(delayAttempt0).toBeLessThanOrEqual(30);

      const delayAttempt2 = policy.computeDelayMs(2, 20, 10);
      // 20 * 2^2 = 80 + jitter (0..10)
      expect(delayAttempt2).toBeGreaterThanOrEqual(80);
      expect(delayAttempt2).toBeLessThanOrEqual(90);
    });

    test("ZeroBackoffPolicy yields zero or deterministic delay without sleeping", async () => {
      const policy = new ZeroBackoffPolicy();
      expect(policy.computeDelayMs(0)).toBe(0);
      expect(policy.computeDelayMs(3)).toBe(0);

      const start = Date.now();
      await policy.delay(5000);
      expect(Date.now() - start).toBeLessThan(100);
    });
  });

  describe("ConcurrencyBarrier", () => {
    test("coordinates multiple parties without sleeps", async () => {
      const barrier = new ConcurrencyBarrier(3);
      const executionOrder: string[] = [];

      const p1 = (async () => {
        executionOrder.push("p1-arrived");
        await barrier.await();
        executionOrder.push("p1-resumed");
      })();

      const p2 = (async () => {
        executionOrder.push("p2-arrived");
        await barrier.await();
        executionOrder.push("p2-resumed");
      })();

      // Yield event loop
      await Promise.resolve();
      expect(executionOrder).toEqual(["p1-arrived", "p2-arrived"]);

      // Third party arrives, unblocking everyone
      const p3 = (async () => {
        executionOrder.push("p3-arrived");
        await barrier.await();
        executionOrder.push("p3-resumed");
      })();

      await Promise.all([p1, p2, p3]);

      expect(executionOrder).toContain("p1-resumed");
      expect(executionOrder).toContain("p2-resumed");
      expect(executionOrder).toContain("p3-resumed");
    });
  });
});
