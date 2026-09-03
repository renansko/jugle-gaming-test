import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";

describe("LocalStack queue bootstrap", () => {
  test("versions the executable initializer for every queue required by the application", () => {
    const initializer = "docker/localstack/init-queues.sh";

    expect(existsSync(initializer)).toBe(true);
    const metadata = statSync(initializer);
    expect(metadata.isFile()).toBe(true);
    if (process.platform !== "win32") {
      expect(metadata.mode & 0o111).not.toBe(0);
    }
    const script = readFileSync(initializer, "utf8");
    expect(script).toContain("wager-transactions.fifo");
    expect(script).toContain("wager-transactions-dlq.fifo");
    expect(script).toContain("wager-events.fifo");
  });
});
