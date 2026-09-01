import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ExchangeRateUnavailableError,
  fetchNbcExchangeRate,
  phnomPenhDate,
} from "@/lib/exchange-rate";
import { toExchangeRate } from "@/lib/supabase/rows";
import type { ExchangeRate } from "@/lib/types";

export interface ExchangeRateWorkerEnv {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

async function recordFetchFailure(
  db: SupabaseClient,
  effectiveDate: string,
  error: unknown,
) {
  const message = error instanceof Error ? error.message : "NBC request failed.";
  const failure = await db.from("exchange_rate_fetch_failures").upsert(
    {
      source: "NBC",
      effective_date: effectiveDate,
      attempted_at: new Date().toISOString(),
      error: message,
    },
    { onConflict: "source,effective_date" },
  );
  if (failure.error) {
    console.error("[exchange-rate] could not record failure", failure.error.message);
  }
}

/**
 * Returns today's saved NBC rate, or refreshes it once. If NBC is temporarily
 * unavailable, the latest successful rate remains usable for invoicing. No
 * rate is invented when the database has never had a successful snapshot.
 */
export async function ensureCurrentSupabaseExchangeRate(
  db: SupabaseClient,
): Promise<ExchangeRate> {
  const today = phnomPenhDate();
  const stored = await db
    .from("exchange_rates")
    .select("*")
    .eq("currency_pair", "USD/KHR")
    .eq("source", "NBC")
    .lte("effective_date", today)
    .order("effective_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (stored.error) {
    throw new ExchangeRateUnavailableError(
      "The official NBC exchange-rate table is not ready.",
    );
  }

  const previous = stored.data ? toExchangeRate(stored.data as Record<string, unknown>) : null;
  if (previous?.effectiveDate === today) return previous;

  try {
    const fetched = await fetchNbcExchangeRate();
    const result = await db
      .from("exchange_rates")
      .upsert(
        {
          currency_pair: fetched.currencyPair,
          rate: fetched.rate,
          source: fetched.source,
          effective_date: fetched.effectiveDate,
          fetched_at: fetched.fetchedAt,
        },
        { onConflict: "currency_pair,effective_date" },
      )
      .select()
      .single();
    if (result.error) throw new ExchangeRateUnavailableError(result.error.message);
    return toExchangeRate(result.data as Record<string, unknown>);
  } catch (error) {
    await recordFetchFailure(db, today, error);
    if (previous) return previous;
    if (error instanceof ExchangeRateUnavailableError) throw error;
    throw new ExchangeRateUnavailableError("NBC exchange rate is unavailable.");
  }
}

/**
 * Runs in the scheduled Cloudflare Worker with the service role. A failed
 * fetch never removes or rewrites the last successful rate.
 */
export async function refreshNbcExchangeRate(
  env: ExchangeRateWorkerEnv,
): Promise<ExchangeRate> {
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service configuration is missing.");

  const db = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return ensureCurrentSupabaseExchangeRate(db);
}
