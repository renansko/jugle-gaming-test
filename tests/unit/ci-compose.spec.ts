import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("Docker integration CI", () => {
  test("runs the test container without reconciling the already-scaled app service", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

    expect(workflow).toContain("run --rm --no-deps test bun run hardening");
    expect(workflow).not.toContain("run --rm test bun run hardening");
  });
});
