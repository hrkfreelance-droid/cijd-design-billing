import { roundMoney } from "@/lib/format";

export type PrintMarkupTier = {
  maxCost: number | null;
  multiplier: number;
  label: string;
};

export const PRINT_MARKUP_TIERS: PrintMarkupTier[] = [
  { maxCost: 20, multiplier: 2, label: "×2.0" },
  { maxCost: 100, multiplier: 1.7, label: "×1.7" },
  { maxCost: null, multiplier: 1.5, label: "×1.5" },
];

export function printMarkupMultiplier(cost: number): number {
  if (cost <= 20) return 2;
  if (cost <= 100) return 1.7;
  return 1.5;
}

/**
 * Customer-facing print price from internal cost.
 *
 * The margin is applied first, then rounded upward so rounding can never erode
 * the intended margin: <= $100 rounds to the next $5, above that to the next $10.
 */
export function suggestedPrintBillingTotal(cost: number): number {
  if (!Number.isFinite(cost) || cost <= 0) return 0;
  const raw = cost * printMarkupMultiplier(cost);
  const step = raw <= 100 ? 5 : 10;
  return roundMoney(Math.ceil(raw / step) * step);
}

export function suggestedPrintBillingUnit(cost: number, quantity: number): number {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  return roundMoney(suggestedPrintBillingTotal(cost) / quantity);
}

export function printPricingRuleSummary(cost: number): string {
  const multiplier = printMarkupMultiplier(cost);
  const suggested = suggestedPrintBillingTotal(cost);
  const step = cost * multiplier <= 100 ? 5 : 10;
  return `Cost ${roundMoney(cost)} × ${multiplier} → round up to $${step} → ${suggested}`;
}