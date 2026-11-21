import type { ServiceRecord, SuggestionIndex } from "./service-suggestions";

export interface PriceEstimate {
  price: number;
  low: number;
  high: number;
  unit: string;
  samples: ServiceRecord[];
}

export interface PriceQuery {
  description: string;
  serviceKey: string;
  quantity: number;
  unit: string;
  projectId?: string;
}

export const priceUnitKey = (unit: string) => {
  const key = unit.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, "");
  return /^(pcs?|pieces?)$/.test(key) ? "pcs" : key;
};

const words = new Intl.Segmenter(undefined, { granularity: "word" });
function features(description: string) {
  let text = description.normalize("NFKC").toLowerCase();
  const size = text.match(/(?:^|[^a-z0-9])a\s*(10|[0-9])(?=$|[^0-9])/u)?.[1] ?? "";
  // Service words alone never make two otherwise unrelated products similar.
  text = text.replace(/\b(?:designs?|artwork|layouts?|prints?|printing|pcs?|pieces?|the|and|for|of)\b|デザイン|印刷|រចនា|បោះពុម្ព/gu, " ")
    .replace(/(?:^|[^a-z0-9])a\s*(?:10|[0-9])(?=$|[^0-9])/gu, " ");
  const tokens = new Set([...words.segment(text)].filter((word) => word.isWordLike)
    .map((word) => word.segment).filter((word) => word.length > 1 && !/^\d+$/u.test(word)));
  return { tokens, size };
}

interface IndexedRecord { row: ServiceRecord; tokens: Set<string>; size: string }
const indexes = new WeakMap<SuggestionIndex, Map<string, IndexedRecord[]>>();
function lookup(index: SuggestionIndex) {
  const cached = indexes.get(index);
  if (cached) return cached;
  const postings = new Map<string, IndexedRecord[]>();
  for (const row of index.records) {
    if (row.price === null || !Number.isFinite(row.price) || row.price < 0) continue;
    const entry = { row, ...features(row.description) };
    for (const token of [...entry.tokens, ...(entry.size ? [`size:a${entry.size}`] : [])]) {
      const key = `${row.serviceKey}|${token}`;
      const list = postings.get(key);
      if (list) list.push(entry);
      else postings.set(key, [entry]);
    }
  }
  indexes.set(index, postings);
  return postings;
}

/** Observed unit prices only. No writes, interpolation or cross-unit averaging. */
export function priceEstimateFor(index: SuggestionIndex, query: PriceQuery): PriceEstimate | null {
  if (!query.description.trim() || !Number.isFinite(query.quantity) || query.quantity <= 0) return null;
  const wanted = features(query.description);
  const postings = lookup(index);
  const entries = new Set<IndexedRecord>();
  for (const token of [...wanted.tokens, ...(wanted.size ? [`size:a${wanted.size}`] : [])]) {
    for (const entry of postings.get(`${query.serviceKey}|${token}`) ?? []) entries.add(entry);
  }
  const unit = priceUnitKey(query.unit);
  let matches = [...entries].flatMap(({ row, tokens, size }) => {
    if (row.projectId === query.projectId || (unit && priceUnitKey(row.unit) !== unit)) return [];
    if (wanted.size && size && wanted.size !== size) return [];
    const shared = [...wanted.tokens].filter((token) => tokens.has(token)).length;
    const sizeMatch = Boolean(wanted.size && wanted.size === size);
    if (!shared && !sizeMatch) return [];
    // Description overlap and an explicit matching size determine the cohort.
    const score = shared / Math.max(1, wanted.tokens.size, tokens.size) + (sizeMatch ? 1 : 0);
    return [{ row, score, distance: Math.abs(Math.log2(row.quantity / query.quantity)) }];
  });
  if (!matches.length) return null;
  const bestScore = matches.reduce((best, match) => Math.max(best, match.score), 0);
  matches = matches.filter((match) => match.score >= bestScore * 0.75);
  // Stay within one doubling of the closest observed quantity. A ×100 job
  // cannot drown out the ×1000 prices when estimating a ×1000 print run.
  const nearest = matches.reduce((best, match) => Math.min(best, match.distance), Infinity);
  matches = matches.filter((match) => match.distance <= nearest + 1);
  matches.sort((a, b) => a.distance - b.distance || b.score - a.score || b.row.date.localeCompare(a.row.date) || a.row.id.localeCompare(b.row.id));
  // If the input unit is blank, choose the nearest cohort's unit and show it
  // in the UI. Applying the estimate also fills that unit into the draft.
  const chosenUnit = priceUnitKey(matches[0].row.unit);
  const samples = matches.filter((match) => priceUnitKey(match.row.unit) === chosenUnit).map((match) => match.row);
  const prices = samples.map((row) => row.price!).sort((a, b) => a - b);
  const middle = Math.floor(prices.length / 2);
  const price = prices.length % 2 ? prices[middle] : (prices[middle - 1] + prices[middle]) / 2;
  return { price: Math.round((price + Number.EPSILON) * 100) / 100, low: prices[0], high: prices[prices.length - 1], unit: samples[0].unit, samples };
}
