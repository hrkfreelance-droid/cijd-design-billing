import { expect, test } from "@playwright/test";

import {
  ExchangeRateUnavailableError,
  fetchAndStoreLatestOfficialRate,
  fetchNbcExchangeRate,
  getApplicableOfficialRate,
  latestOfficialRateCheckedAt,
} from "../src/lib/exchange-rate";
import type { Database, ExchangeRate } from "../src/lib/types";

function rate(effectiveDate: string, value: number): ExchangeRate {
  return {
    id: effectiveDate,
    currencyPair: "USD/KHR",
    rate: value,
    source: "NBC",
    effectiveDate,
    fetchedAt: `${effectiveDate}T10:00:00.000Z`,
  };
}

function emptyDatabase(): Database {
  return {
    clients: [],
    projects: [],
    billingItems: [],
    invoices: [],
    invoiceItems: [],
    payments: [],
    users: [],
    auditLogs: [],
    telegramSessions: [],
    notifications: [],
    exchangeRates: [],
    exchangeRateFailures: [],
  };
}

function nbcResponse(data: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test.describe("NBC exchange-rate boundaries", () => {
  test("stores a future effective date and exposes only arrived rates", async () => {
    const db = emptyDatabase();
    const saved = await fetchAndStoreLatestOfficialRate(
      db,
      async () =>
        nbcResponse({
          currency_id: "USD",
          symbol: "USD/KHR",
          valid_date: "2026-09-02",
          average: 4047,
        }),
    );

    expect(saved.effectiveDate).toBe("2026-09-02");
    expect(saved.rate).toBe(4047);
    expect(Date.parse(saved.fetchedAt)).not.toBeNaN();
    expect(db.exchangeRates).toHaveLength(1);
    expect(getApplicableOfficialRate(db.exchangeRates, new Date("2026-09-01T16:59:59Z"))).toBeNull();
    expect(getApplicableOfficialRate(db.exchangeRates, new Date("2026-09-01T17:00:00Z"))).toEqual(saved);
  });

  test("uses the latest working-day rate on weekends", () => {
    const rates = [rate("2026-09-04", 4046), rate("2026-09-07", 4048)];
    const saturday = new Date("2026-09-05T04:00:00Z");
    expect(getApplicableOfficialRate(rates, saturday)).toEqual(rates[0]);
  });

  test("reports the latest successful check even when that rate is future-dated", () => {
    const current = rate("2026-09-01", 4046);
    const future = rate("2026-09-02", 4047);
    current.fetchedAt = "2026-09-01T09:00:00.000Z";
    future.fetchedAt = "2026-09-01T09:35:00.000Z";

    expect(getApplicableOfficialRate([current, future], new Date("2026-09-01T10:00:00Z"))).toEqual(current);
    expect(latestOfficialRateCheckedAt([current, future])).toBe(future.fetchedAt);
  });

  test("rejects invalid currency and non-positive rates", async () => {
    const invalidCurrency = fetchNbcExchangeRate(async () =>
      nbcResponse({ currency_id: "EUR", symbol: "EUR/KHR", valid_date: "2026-09-02", average: 4047 }),
    );
    const invalidRate = fetchNbcExchangeRate(async () =>
      nbcResponse({ currency_id: "USD", symbol: "USD/KHR", valid_date: "2026-09-02", average: 0 }),
    );

    await expect(invalidCurrency).rejects.toBeInstanceOf(ExchangeRateUnavailableError);
    await expect(invalidRate).rejects.toBeInstanceOf(ExchangeRateUnavailableError);
  });
});
