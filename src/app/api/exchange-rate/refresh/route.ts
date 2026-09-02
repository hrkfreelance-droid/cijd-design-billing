import { handleAs } from "@/lib/api";
import { RuleError } from "@/lib/data/repository";
import {
  refreshNbcExchangeRate,
  type ExchangeRateWorkerEnv,
} from "@/lib/exchange-rate-server";

/**
 * Refresh is intentionally server-only: the browser never receives a service
 * key and never calls NBC/MEF directly.
 */
export async function POST() {
  return handleAs(async () => {
    try {
      const result = await refreshNbcExchangeRate({
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      } satisfies ExchangeRateWorkerEnv);
      return result;
    } catch {
      throw new RuleError(
        "EXCHANGE_RATE_REFRESH_FAILED",
        "Official rate could not be refreshed. The latest saved rate is still in use.",
        503,
      );
    }
  });
}
