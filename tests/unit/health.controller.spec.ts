import { expect, test } from "bun:test";
import { ServiceUnavailableException } from "@nestjs/common";
import { HealthController } from "../../src/interfaces/http/health/health.controller";
import type { DependenciesHealthService } from "../../src/infrastructure/health/dependencies-health.service";

test("liveness is independent from external dependencies", () => {
  const controller = new HealthController({ check: async () => ({ database: "down", sqs: "down" }) } as DependenciesHealthService);

  expect(controller.live()).toEqual({ status: "ok" });
});

test("readiness returns 503 with dependency status when a dependency is unavailable", async () => {
  const controller = new HealthController({ check: async () => ({ database: "up", sqs: "down" }) } as DependenciesHealthService);

  await expect(controller.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
});

test("readiness returns 200 with status ok when all dependencies are healthy", async () => {
  const controller = new HealthController({ check: async () => ({ database: "up", sqs: "up" }) } as DependenciesHealthService);

  await expect(controller.ready()).resolves.toEqual({
    status: "ok",
    dependencies: { database: "up", sqs: "up" },
  });
});

