import { expect, test } from "bun:test";

test("health integration is skipped when TEST_APP_URL is absent", () => {
  const { TEST_APP_URL: _ignored, ...environmentWithoutAppUrl } = process.env;
  const result = Bun.spawnSync({
    cmd: ["bun", "test", "tests/integration/health.placeholder.spec.ts"],
    env: environmentWithoutAppUrl,
    stderr: "pipe",
    stdout: "pipe",
  });
  const output = `${result.stdout.toString()}\n${result.stderr.toString()}`;

  expect(result.exitCode).toBe(0);
  expect(output).toContain("1 skip");
  expect(output).not.toContain("1 fail");
});
