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

export interface ExchangeRateRefreshResult {
  /** The latest rate usable in Phnom Penh today; null is valid before a first applicable rate. */
  rate: ExchangeRate | null;
  /** The official snapshot returned by the most recent successful fetch. */
  fetched: ExchangeRate;
  /** False means a recent successful check was reused without changing fetchedAt. */
  checked: boolean;
}

const MANUAL_REFRESH_COOLDOWN_MS = 45_000;
let inFlightRefresh: Promise<ExchangeRateRefreshResult> | null = null;

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

/** Returns the newest saved official rate whose effective date has arrived. */
export async function getApplicableOfficialRate(
  db: SupabaseClient,
  now = new Date(),
): Promise<ExchangeRate | null> {
  const result = await db
    .from("exchange_rates")
    .select("*")
    .eq("currency_pair", "USD/KHR")
    .eq("source", "NBC")
    .lte("effective_date", phnomPenhDate(now))
    .order("effective_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) {
    throw new ExchangeRateUnavailableError(
      "The official NBC exchange-rate table is not ready.",
    );
  }
  return result.data ? toExchangeRate(result.data as Record<string, unknown>) : null;
}

async function mostRecentlyFetchedOfficialRate(
  db: SupabaseClient,
): Promise<ExchangeRate | null> {
  const result = await db
    .from("exchange_rates")
    .select("*")
    .eq("currency_pair", "USD/KHR")
    .eq("source", "NBC")
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) {
    throw new ExchangeRateUnavailableError(
      "The official NBC exchange-rate table is not ready.",
    );
  }
  return result.data ? toExchangeRate(result.data as Record<string, unknown>) : null;
}

/** Stores every successful official response, including a future effective date. */
export async function fetchAndStoreLatestOfficialRate(
  db: SupabaseClient,
): Promise<ExchangeRate> {
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
}

/**
 * Returns today's saved NBC rate, or refreshes it once when today's applicable
 * rate is missing. A future rate is stored but never used before its date.
 */
export async function ensureCurrentSupabaseExchangeRate(
  db: SupabaseClient,
): Promise<ExchangeRate> {
  const today = phnomPenhDate();
  const previous = await getApplicableOfficialRate(db);
  if (previous?.effectiveDate === today) return previous;

  try {
    await fetchAndStoreLatestOfficialRate(db);
    const applicable = await getApplicableOfficialRate(db);
    if (applicable) return applicable;
    throw new ExchangeRateUnavailableError(
      "NBC returned a rate for a future effective date.",
    );
  } catch (error) {
    await recordFetchFailure(db, today, error);
    if (previous) return previous;
    if (error instanceof ExchangeRateUnavailableError) throw error;
    throw new ExchangeRateUnavailableError("NBC exchange rate is unavailable.");
  }
}

function serviceClient(env: ExchangeRateWorkerEnv): SupabaseClient {
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service configuration is missing.");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function runRefresh(
  env: ExchangeRateWorkerEnv,
  force: boolean,
): Promise<ExchangeRateRefreshResult> {
  const db = serviceClient(env);
  if (!force) {
    const recent = await mostRecentlyFetchedOfficialRate(db);
    const fetchedAt = recent ? Date.parse(recent.fetchedAt) : Number.NaN;
    if (
      recent &&
      Number.isFinite(fetchedAt) &&
      Date.now() - fetchedAt < MANUAL_REFRESH_COOLDOWN_MS
    ) {
      return {
        rate: await getApplicableOfficialRate(db),
        fetched: recent,
        checked: false,
      };
    }
  }

  try {
    const fetched = await fetchAndStoreLatestOfficialRate(db);
    return {
      fetched,
      rate: await getApplicableOfficialRate(db),
      checked: true,
    };
  } catch (error) {
    await recordFetchFailure(db, phnomPenhDate(), error);
    throw error instanceof ExchangeRateUnavailableError
      ? error
      : new ExchangeRateUnavailableError("NBC exchange rate is unavailable.");
  }
}

/**
 * Manual Refresh uses a short server-side cooldown and in-flight dedupe. The
 * scheduled Worker passes force=true so the three planned checks always query
 * NBC independently.
 */
export async function refreshNbcExchangeRate(
  env: ExchangeRateWorkerEnv,
  options: { force?: boolean } = {},
): Promise<ExchangeRateRefreshResult> {
  if (inFlightRefresh) return inFlightRefresh;
  const run = runRefresh(env, options.force === true);
  inFlightRefresh = run.finally(() => {
    inFlightRefresh = null;
  });
  return inFlightRefresh;
}
