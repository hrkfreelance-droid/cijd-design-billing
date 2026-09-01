import type { Database, ExchangeRate } from "@/lib/types";

/**
 * NBC's official USD/KHR rate is distributed through the Cambodian Ministry
 * of Economy and Finance realtime endpoint. The response is validated as
 * USD/KHR before it enters the application ledger; no fallback value is
 * invented here.
 */
export const NBC_RATE_ENDPOINT =
  "https://data.mef.gov.kh/api/v1/realtime-api/exchange-rate?currency_id=USD";
export const CURRENCY_PAIR = "USD/KHR" as const;
export const RATE_SOURCE = "NBC" as const;
export const PHNOM_PENH_TIME_ZONE = "Asia/Phnom_Penh";

interface NbcResponse {
  data?: {
    currency_id?: unknown;
    symbol?: unknown;
    valid_date?: unknown;
    average?: unknown;
    bid?: unknown;
    ask?: unknown;
  };
}

export interface FetchedExchangeRate {
  currencyPair: typeof CURRENCY_PAIR;
  rate: number;
  source: typeof RATE_SOURCE;
  effectiveDate: string;
  fetchedAt: string;
}

export class ExchangeRateUnavailableError extends Error {
  constructor(message = "NBC exchange rate is unavailable.") {
    super(message);
    this.name = "ExchangeRateUnavailableError";
  }
}

export function phnomPenhDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PHNOM_PENH_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function latestExchangeRate(
  rates: ExchangeRate[] | undefined,
  now = new Date(),
): ExchangeRate | null {
  const today = phnomPenhDate(now);
  return [...(rates ?? [])]
    .filter(
      (rate) =>
        rate.currencyPair === CURRENCY_PAIR &&
        rate.source === RATE_SOURCE &&
        rate.rate > 0 &&
        rate.effectiveDate <= today,
    )
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0] ?? null;
}

export function khrAmount(usdAmount: number, rate: number): number {
  return Math.round(usdAmount * rate);
}

export function formatKhr(usdAmount: number, rate: number): string {
  return `៛${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(khrAmount(usdAmount, rate))}`;
}

export function formatRate(rate: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(rate);
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function fetchNbcExchangeRate(
  fetcher: typeof fetch = fetch,
): Promise<FetchedExchangeRate> {
  let response: Response;
  try {
    response = await fetcher(NBC_RATE_ENDPOINT, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
  } catch (error) {
    throw new ExchangeRateUnavailableError(
      error instanceof Error ? error.message : "NBC request failed.",
    );
  }
  if (!response.ok) {
    throw new ExchangeRateUnavailableError(`NBC request returned ${response.status}.`);
  }

  let payload: NbcResponse;
  try {
    payload = (await response.json()) as NbcResponse;
  } catch {
    throw new ExchangeRateUnavailableError("NBC returned invalid JSON.");
  }
  const data = payload.data;
  const rawRate = data?.average ?? data?.bid ?? data?.ask;
  const rate = typeof rawRate === "number" ? rawRate : Number(rawRate);
  if (
    data?.currency_id !== "USD" ||
    data?.symbol !== CURRENCY_PAIR ||
    !Number.isFinite(rate) ||
    rate <= 0 ||
    !validDate(data?.valid_date)
  ) {
    throw new ExchangeRateUnavailableError("NBC returned an invalid USD/KHR rate.");
  }

  return {
    currencyPair: CURRENCY_PAIR,
    rate,
    source: RATE_SOURCE,
    effectiveDate: data.valid_date,
    fetchedAt: new Date().toISOString(),
  };
}

function newId(): string {
  return globalThis.crypto.randomUUID();
}

/** Local/demo persistence helper. Production uses the scheduled Worker. */
export async function ensureCurrentExchangeRate(db: Database): Promise<ExchangeRate> {
  const previous = latestExchangeRate(db.exchangeRates);
  const today = phnomPenhDate();
  if (previous?.effectiveDate === today) return previous;
  try {
    const fetched = await fetchNbcExchangeRate();
    const existing = db.exchangeRates.find(
      (rate) =>
        rate.currencyPair === fetched.currencyPair &&
        rate.effectiveDate === fetched.effectiveDate,
    );
    const current: ExchangeRate = existing ?? { id: newId(), ...fetched };
    Object.assign(current, fetched);
    if (!existing) db.exchangeRates.push(current);
    return current;
  } catch (error) {
    const effectiveDate = today;
    const failure = db.exchangeRateFailures.find(
      (entry) => entry.source === RATE_SOURCE && entry.effectiveDate === effectiveDate,
    );
    const message = error instanceof Error ? error.message : "NBC request failed.";
    if (failure) {
      failure.attemptedAt = new Date().toISOString();
      failure.error = message;
    } else {
      db.exchangeRateFailures.push({
        id: newId(),
        source: RATE_SOURCE,
        effectiveDate,
        attemptedAt: new Date().toISOString(),
        error: message,
      });
    }
    if (previous) return previous;
    throw new ExchangeRateUnavailableError(message);
  }
}
