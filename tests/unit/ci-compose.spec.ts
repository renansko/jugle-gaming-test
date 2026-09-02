import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("Docker integration CI", () => {
  test("runs the test container without reconciling the already-scaled app service", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

    expect(workflow).toContain("run --rm --no-deps test bun run hardening");
    expect(workflow).not.toContain("run --rm test bun run hardening");
  });

  test("waits for real infrastructure health before running reversible migrations", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

    expect(workflow).toContain("up -d --build --wait postgres localstack");
  });

  test("keeps automatic workers disabled in the directed hardening stack", () => {
    const hardeningCompose = readFileSync("compose.hardening.yaml", "utf8");

    expect(hardeningCompose).toContain('TEST_WORKERS_AUTOSTART: "false"');
    expect(hardeningCompose).not.toContain('TEST_WORKERS_AUTOSTART: "true"');
  });
});
