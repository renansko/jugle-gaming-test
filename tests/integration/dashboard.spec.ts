import { describe, expect, test } from "bun:test";

const baseUrl = process.env.TEST_APP_URL;
const integration = baseUrl ? describe : describe.skip;

async function request(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...init?.headers },
  });
}

integration("Observability & Dashboard integration", () => {
  test("serves live web dashboard HTML with real-time UI components", async () => {
    const res = await request("/dashboard");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");

    const html = await res.text();
    expect(html).toContain("Jungle Gaming — Wagering Observability");
    expect(html).toContain("wager_processing_latency_ms");
    expect(html).toContain("wallet_lock_duration_ms");
    expect(html).toContain("fetchData");
  });

  test("negotiates Prometheus text/plain format by default or JSON when requested", async () => {
    // 1. Default Prometheus format
    const promRes = await request("/metrics");
    expect(promRes.status).toBe(200);
    const promText = await promRes.text();
    expect(promText).toContain("# HELP wager_transactions_total");
    expect(promText).toContain("wager_transactions_total");

    // 2. JSON format with Accept: application/json
    const jsonRes = await request("/metrics", {
      headers: { accept: "application/json" },
    });
    expect(jsonRes.status).toBe(200);
    const jsonBody = (await jsonRes.json()) as Record<string, number>;
    expect(typeof jsonBody).toBe("object");
    expect(jsonBody["wager_transactions_total{}"]).toBeDefined();
  });
});
