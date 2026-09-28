import assert from "node:assert/strict";
import test from "node:test";

import { fetchNbcRate } from "../src/server/nbc.ts";

test("accepts only an official USD/KHR response", async () => {
  const fetcher = (async () => new Response(JSON.stringify({ data: { currency_id: "USD", symbol: "USD/KHR", valid_date: "2026-09-28", average: "4026" } }), { status: 200 })) as typeof fetch;
  const rate = await fetchNbcRate(fetcher);
  assert.deepEqual(rate, { rateKhrPerUsd: 4026, source: "NBC", effectiveDate: "2026-09-28" });
});

test("rejects a mismatched currency response", async () => {
  const fetcher = (async () => new Response(JSON.stringify({ data: { currency_id: "EUR", symbol: "EUR/KHR", valid_date: "2026-09-28", average: 4500 } }), { status: 200 })) as typeof fetch;
  await assert.rejects(() => fetchNbcRate(fetcher), /invalid USD\/KHR/);
});
