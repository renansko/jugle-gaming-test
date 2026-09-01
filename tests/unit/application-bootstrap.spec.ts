import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("application bootstrap", () => {
  test("does not configure an unavailable optional ValidationPipe package", () => {
    const main = readFileSync("src/main.ts", "utf8");

    expect(main.includes("ValidationPipe")).toBe(false);
  });
});
