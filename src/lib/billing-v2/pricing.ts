/**
 * The printing price rule, written once.
 *
 * Cost is what the print shop charges us. The billing price is derived from a
 * margin band and always lands on a $5 step, rounded up, so the office can say
 * the number out loud. Nothing else in the app recomputes this.
 *
 * Deliberately free of `@/` runtime imports so the rule can be unit tested on
 * its own, without the Next.js path aliases.
 */

export interface MarginBand {
  /** Applies while the cost is at or below this amount. */
  upTo: number;
  margin: number;
}

/** Ordered, and closed by an open-ended final band. */
export const PRINT_MARGIN_BANDS: readonly MarginBand[] = [
  { upTo: 50, margin: 0.5 },
  { upTo: 100, margin: 0.4 },
  { upTo: Number.POSITIVE_INFINITY, margin: 0.3 },
];

/** Prices are quoted in whole $5 steps. */
export const PRICE_STEP = 5;

export function roundCents(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/**
 * Unit cost for display when it is derived from Total Cost ÷ Quantity: a
 * $30-for-900 job is $0.0333, not $0.03, so this keeps the fraction that
 * matters while still collapsing a whole-dollar unit cost to plain cents.
 */
export function formatUnitCost(value: number): string {
  if (!Number.isFinite(value)) return "";
  const rounded = Math.round((value + Number.EPSILON) * 1e6) / 1e6;
  let text = rounded.toFixed(4);
  while (text[text.length - 1] === "0" && text.split(".")[1].length > 2) {
    text = text.slice(0, -1);
  }
  return text;
}

export function printMarginFromCost(cost: number): number {
  if (!Number.isFinite(cost) || cost < 0) return 0;
  return PRINT_MARGIN_BANDS.find((band) => cost <= band.upTo)?.margin ?? 0.3;
}

/**
 * cost / (1 - margin), rounded *up* to the next $5.
 *
 * The epsilon keeps a price that already sits exactly on a step — $50 cost is
 * exactly $100 — from being pushed to the step above it by float noise.
 */
export function printSellingPriceFromCost(cost: number): number {
  if (!Number.isFinite(cost) || cost < 0) return 0;
  const selling = cost / (1 - printMarginFromCost(cost));
  return roundCents(Math.ceil((selling - Number.EPSILON) / PRICE_STEP) * PRICE_STEP);
}

/**
 * What the final billing price becomes after the cost changes.
 *
 * A price a person typed is theirs: a later cost edit refreshes the
 * recommendation beside it but never overwrites the number they chose.
 */
export function nextFinalPrice(input: {
  cost: number | null;
  /** The final price has been overridden by hand. */
  manual: boolean;
  currentFinal: number;
}): number {
  if (input.manual) return input.currentFinal;
  if (input.cost == null) return input.currentFinal;
  return printSellingPriceFromCost(input.cost);
}
