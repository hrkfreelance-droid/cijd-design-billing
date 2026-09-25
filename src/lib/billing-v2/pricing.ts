/**
 * The printing price rule, written once.
 *
 * Cost is what the print shop charges us. The recommended billing price is
 * that cost plus a markup that depends on the size of the job:
 *
 *   Cost Total <= $50          → +50%
 *   Cost Total >  $50, <= $100 → +40%
 *   Cost Total >  $100         → +30%
 *
 *   Recommended Total = Cost Total × (1 + markup), rounded to cents.
 *
 * The same rule lives in SQL as `public.print_recommended_amount`; the two
 * must always agree. Nothing else in the app recomputes it.
 *
 * Deliberately free of `@/` runtime imports so the rule can be unit tested on
 * its own, without the Next.js path aliases.
 */

export interface MarkupBand {
  /** Applies while the cost is at or below this amount. */
  upTo: number;
  /** Markup on cost, as a fraction (0.5 = +50%). */
  markup: number;
}

/** Ordered, and closed by an open-ended final band. */
export const PRINT_MARKUP_BANDS: readonly MarkupBand[] = [
  { upTo: 50, markup: 0.5 },
  { upTo: 100, markup: 0.4 },
  { upTo: Number.POSITIVE_INFINITY, markup: 0.3 },
];

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

/** The default markup for a job of this total cost, as a fraction. */
export function printMarkupFromCost(cost: number): number {
  if (!Number.isFinite(cost) || cost < 0) return 0;
  return PRINT_MARKUP_BANDS.find((band) => cost <= band.upTo)?.markup ?? 0.3;
}

/**
 * Kept for the V2 screens, which label the band beside the recommendation.
 * The value is the markup on cost — the 50 / 40 / 30 bands were never a
 * gross margin.
 */
export const printMarginFromCost = printMarkupFromCost;

/** Cost × (1 + markup), to the cent. `markup` defaults to the band for `cost`. */
export function recommendedFromCost(cost: number, markup: number = printMarkupFromCost(cost)): number {
  if (!Number.isFinite(cost) || cost < 0 || !Number.isFinite(markup)) return 0;
  return roundCents(cost * (1 + markup));
}

/**
 * The markup used for a line, as a fraction: its stored manual override
 * (a percentage, e.g. 35 for +35%) when there is one, otherwise the band.
 */
export function markupForCost(cost: number, overridePercent?: number | null): number {
  if (overridePercent != null && Number.isFinite(overridePercent) && overridePercent >= 0) {
    return overridePercent / 100;
  }
  return printMarkupFromCost(cost);
}

/**
 * The recommended total for this cost: at the line's manual markup override
 * when it has one, otherwise at the default band.
 */
export function printSellingPriceFromCost(cost: number, overridePercent?: number | null): number {
  return recommendedFromCost(cost, markupForCost(cost, overridePercent));
}

/**
 * What the final price actually marks the cost up by, as a percentage
 * (37.5 for +37.5%). Null when there is no cost to mark up.
 */
export function effectiveMarkupPercent(finalTotal: number | null, cost: number | null): number | null {
  if (finalTotal == null || cost == null || !Number.isFinite(finalTotal) || !(cost > 0)) return null;
  return Math.round(((finalTotal - cost) / cost) * 100 * 10) / 10;
}

/** A markup percentage for display: 50 → "50", 37.5 → "37.5". */
export function formatPercent(percent: number): string {
  const rounded = Math.round(percent * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * A final unit price and total belong together when one is the other at this
 * quantity, to the cent: either the total is unit × qty (a unit price was
 * set), or the unit price is total ÷ qty (a total was typed).
 */
export function finalPriceConsistent(quantity: number, unitPrice: number, amount: number): boolean {
  if (!(quantity > 0) || !Number.isFinite(unitPrice) || !Number.isFinite(amount)) return false;
  const unit = roundCents(unitPrice);
  const total = roundCents(amount);
  return total === roundCents(quantity * unit) || unit === roundCents(total / quantity);
}

/**
 * Money already received against a project, and what is left to collect.
 *
 * A deposit never changes a price: it only splits the final total into what
 * has been paid and what is still owed. More than the total is recorded as
 * overpaid rather than as a negative balance.
 */
export interface ProjectBalance {
  finalTotal: number;
  deposit: number;
  remaining: number;
  overpaid: number;
  /** Something was received and nothing is left to collect. */
  settled: boolean;
}

export function projectBalance(finalTotal: number, deposit: number | null | undefined): ProjectBalance {
  const total = roundCents(Math.max(finalTotal, 0));
  const paid = deposit == null || !Number.isFinite(deposit) || deposit < 0 ? 0 : roundCents(deposit);
  return {
    finalTotal: total,
    deposit: paid,
    remaining: roundCents(Math.max(total - paid, 0)),
    overpaid: roundCents(Math.max(paid - total, 0)),
    settled: paid > 0 && paid >= total,
  };
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
