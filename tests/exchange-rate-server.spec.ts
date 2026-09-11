import { expect, test } from "@playwright/test";

import { NBC_RATE_ENDPOINT } from "../src/lib/exchange-rate";
import { refreshNbcExchangeRate } from "../src/lib/exchange-rate-server";

test("server refresh deduplicates concurrent checks and reuses a recent success", async () => {
  const originalFetch = globalThis.fetch;
  let nbcCalls = 0;
  let savedRow: Record<string, unknown> | null = null;

  globalThis.fetch = async (input, init) => {
    const requestUrl =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (requestUrl === NBC_RATE_ENDPOINT) {
      nbcCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 15));
      return new Response(
        JSON.stringify({
          data: {
            currency_id: "USD",
            symbol: "USD/KHR",
            valid_date: "2026-09-02",
            average: 4047,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (requestUrl.includes("/rest/v1/exchange_rates")) {
      if ((init?.method ?? "GET") === "POST") {
        const payload = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>[];
        savedRow = { ...(payload[0] ?? payload), id: "server-rate-id" };
        return new Response(JSON.stringify(savedRow), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify(savedRow ? [savedRow] : []), { status: 200 });
    }

    throw new Error(`Unexpected request in fake Supabase: ${requestUrl}`);
  };

  try {
    const env = {
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-only-key",
    };
    const [first, second] = await Promise.all([
      refreshNbcExchangeRate(env, { force: true }),
      refreshNbcExchangeRate(env, { force: true }),
    ]);

    expect(first).toEqual(second);
    expect(first.checked).toBe(true);
    expect(savedRow).toMatchObject({ rate: 4047, currency_pair: "USD/KHR" });
    expect(first.fetched.rate).toBe(4047);
    expect(nbcCalls).toBe(1);

    const reused = await refreshNbcExchangeRate(env);
    expect(reused.checked).toBe(false);
    expect(reused.fetched.fetchedAt).toBe(first.fetched.fetchedAt);
    expect(nbcCalls).toBe(1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
