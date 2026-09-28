import type { FinalMode } from "./types";

export function roundCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function markupFromCost(totalCost: number): number {
  if (!Number.isFinite(totalCost) || totalCost < 0) return 0;
  if (totalCost <= 50) return 0.5;
  if (totalCost <= 100) return 0.4;
  return 0.3;
}

export function recommendedTotal(totalCost: number, overridePercent: number | null = null): number {
  const markup = overridePercent == null ? markupFromCost(totalCost) : overridePercent / 100;
  return roundCents(totalCost * (1 + markup));
}

export function calculateBillingLine(input: {
  quantity: number;
  unitCostUsd: number | null;
  markupOverridePercent: number | null;
  finalMode: FinalMode;
  currentFinalUnitUsd: number | null;
  currentFinalTotalUsd: number | null;
}): {
  totalCostUsd: number | null;
  recommendedTotalUsd: number | null;
  finalUnitUsd: number;
  finalTotalUsd: number;
} {
  if (!(input.quantity > 0)) throw new Error("Quantity must be greater than zero");
  const totalCostUsd = input.unitCostUsd == null ? null : roundCents(input.unitCostUsd * input.quantity);
  const recommendation = totalCostUsd == null ? null : recommendedTotal(totalCostUsd, input.markupOverridePercent);

  if (input.finalMode === "AUTO") {
    if (recommendation == null) throw new Error("Automatic final price requires unit cost");
    return {
      totalCostUsd,
      recommendedTotalUsd: recommendation,
      finalUnitUsd: roundCents(recommendation / input.quantity),
      finalTotalUsd: recommendation,
    };
  }

  if (input.finalMode === "UNIT") {
    if (input.currentFinalUnitUsd == null || input.currentFinalUnitUsd < 0) throw new Error("Final unit price is required");
    return {
      totalCostUsd,
      recommendedTotalUsd: recommendation,
      finalUnitUsd: roundCents(input.currentFinalUnitUsd),
      finalTotalUsd: roundCents(input.currentFinalUnitUsd * input.quantity),
    };
  }

  if (input.currentFinalTotalUsd == null || input.currentFinalTotalUsd < 0) throw new Error("Final total is required");
  return {
    totalCostUsd,
    recommendedTotalUsd: recommendation,
    finalUnitUsd: roundCents(input.currentFinalTotalUsd / input.quantity),
    finalTotalUsd: roundCents(input.currentFinalTotalUsd),
  };
}

export function projectBalance(finalTotal: number, deposit: number): { finalTotal: number; deposit: number; remaining: number; overpaid: number } {
  const total = roundCents(Math.max(0, finalTotal));
  const paid = roundCents(Math.max(0, deposit));
  return {
    finalTotal: total,
    deposit: paid,
    remaining: roundCents(Math.max(0, total - paid)),
    overpaid: roundCents(Math.max(0, paid - total)),
  };
}
