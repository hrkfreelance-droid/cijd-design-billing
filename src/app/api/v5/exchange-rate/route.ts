import { handleV5 } from "@/lib/billing-v5/api";
import { RuleError } from "@/lib/data/repository";
import { phnomPenhDate } from "@/lib/exchange-rate";

export const dynamic = "force-dynamic";

/**
 * The official NBC USD/KHR rate for an invoice date, from V5's stored NBC
 * history. For today (Phnom Penh) a missing rate is fetched first. `rate: null`
 * means there is no official rate for that date: Accounting enters it by hand.
 */
export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date") ?? phnomPenhDate();
  return handleV5(["invoice:write", "payment:write"], async (store) => {
    let rate = await store.rateForDate(date);
    let fetched: boolean | null = null;
    if (!rate && date === phnomPenhDate()) {
      try {
        await store.refreshOfficialRate();
        fetched = true;
      } catch {
        fetched = false;
      }
      rate = await store.rateForDate(date);
    }
    return { date, rate, fetched };
  });
}

/**
 * Fetch today's NBC USD/KHR rate into V5's store (never into V3's).
 * NBC being unreachable is an expected, handled outcome — Accounting then
 * types the rate — so it is an answer (`fetched: false`), not a server error.
 */
export async function POST() {
  return handleV5(["invoice:write", "payment:write"], async (store) => {
    try {
      return { fetched: true as const, rate: await store.refreshOfficialRate() };
    } catch (error) {
      if (error instanceof RuleError && error.code === "EXCHANGE_RATE_REFRESH_FAILED") {
        return { fetched: false as const, message: error.message };
      }
      throw error;
    }
  });
}
