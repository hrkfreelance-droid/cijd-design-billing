import { handleV5 } from "@/lib/billing-v5/api";
import { RuleError } from "@/lib/data/repository";

export const dynamic = "force-dynamic";

/**
 * Fetch today's NBC USD/KHR rate into V5's store (never into V3's).
 *
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
