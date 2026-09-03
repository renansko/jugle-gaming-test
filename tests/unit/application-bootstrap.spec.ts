import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createApplicationLogger } from "../../src/infrastructure/observability/application-logger";

describe("application bootstrap", () => {
  test("configures only available bootstrap dependencies and production JSON logs", () => {
    const main = readFileSync("src/main.ts", "utf8");

    expect(main.includes("ValidationPipe")).toBe(false);
    expect(main).toContain("createApplicationLogger(config.nodeEnv)");

    const writes: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = mock((chunk: string | Uint8Array) => {
      writes.push(chunk.toString());
      return true;
    }) as typeof process.stdout.write;

    try {
      createApplicationLogger("production").log(
        { event: "application_started" },
        "Bootstrap",
      );
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(writes).toHaveLength(1);
    expect(writes[0]).not.toContain("\u001b[");
    expect(JSON.parse(writes[0] ?? "")).toMatchObject({
      level: "log",
      message: { event: "application_started" },
      context: "Bootstrap",
    });
  });
});
