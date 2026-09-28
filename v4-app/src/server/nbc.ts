export const NBC_RATE_ENDPOINT = "https://data.mef.gov.kh/api/v1/realtime-api/exchange-rate?currency_id=USD";

export async function fetchNbcRate(fetcher: typeof fetch = fetch) {
  const response = await fetcher(NBC_RATE_ENDPOINT, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`NBC request returned ${response.status}`);
  const payload = (await response.json()) as {
    data?: { currency_id?: unknown; symbol?: unknown; valid_date?: unknown; average?: unknown; bid?: unknown; ask?: unknown };
  };
  const data = payload.data;
  const raw = data?.average ?? data?.bid ?? data?.ask;
  const rate = typeof raw === "number" ? raw : Number(raw);
  if (
    data?.currency_id !== "USD" ||
    data?.symbol !== "USD/KHR" ||
    typeof data.valid_date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(data.valid_date) ||
    !Number.isFinite(rate) ||
    rate <= 0
  ) throw new Error("NBC returned an invalid USD/KHR rate");
  return { rateKhrPerUsd: rate, source: "NBC", effectiveDate: data.valid_date };
}
