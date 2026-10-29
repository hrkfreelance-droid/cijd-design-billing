/** Pure integer-cent helpers shared by the server rules, preview, and tests. */

export interface CentWeight {
  id: string;
  cents: number;
}

/**
 * Allocate an amount over linked billing lines by largest remainder.
 * Integer arithmetic keeps the allocation exact and stable across clients.
 */
export function allocateCentsProportionally(totalCents: number, weights: readonly CentWeight[]): Map<string, number> {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) throw new RangeError("totalCents must be a non-negative safe integer");
  if (new Set(weights.map((weight) => weight.id)).size !== weights.length) throw new RangeError("weight ids must be unique");
  if (weights.some((weight) => !Number.isSafeInteger(weight.cents) || weight.cents < 0)) {
    throw new RangeError("weights must be non-negative safe integers");
  }
  const denominator = weights.reduce((sum, weight) => sum + BigInt(weight.cents), BigInt(0));
  if (totalCents > 0 && denominator === BigInt(0)) throw new RangeError("cannot allocate over empty weights");
  if (BigInt(totalCents) > denominator) throw new RangeError("allocation exceeds available weights");
  if (denominator === BigInt(0)) return new Map(weights.map((weight) => [weight.id, 0]));

  const target = BigInt(totalCents);
  const rows = weights.map((weight, index) => {
    const numerator = target * BigInt(weight.cents);
    return { id: weight.id, index, cents: numerator / denominator, remainder: numerator % denominator };
  });
  let residual = target - rows.reduce((sum, row) => sum + row.cents, BigInt(0));
  const order = [...rows].sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));
  for (const row of order) {
    if (residual === BigInt(0)) break;
    row.cents += BigInt(1);
    residual -= BigInt(1);
  }
  return new Map(rows.map((row) => [row.id, Number(row.cents)]));
}

/** Half-up integer-cent result for a percentage of a cent amount. */
export function percentageOfCents(totalCents: number, percent: number): number {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0 || !Number.isFinite(percent) || percent < 0) {
    throw new RangeError("invalid percentage amount");
  }
  const scaledPercent = BigInt(Math.round(percent * 100_000_000));
  const numerator = BigInt(totalCents) * scaledPercent;
  const denominator = BigInt(10_000_000_000); // 100 percent × 1e8 fractional precision
  return Number((numerator * BigInt(2) + denominator) / (BigInt(2) * denominator));
}

/** VAT cents accumulated proportionally, with the final slice taking the exact remainder. */
export function cumulativeVatSliceCents(
  contractVatCents: number,
  contractBaseCents: number,
  previouslyAllocatedBaseCents: number,
  currentBaseCents: number,
  previouslyAllocatedVatCents: number,
): number {
  if (![contractVatCents, contractBaseCents, previouslyAllocatedBaseCents, currentBaseCents, previouslyAllocatedVatCents].every(Number.isSafeInteger)) {
    throw new RangeError("VAT slice inputs must be safe integers");
  }
  if (contractVatCents < 0 || contractBaseCents <= 0 || previouslyAllocatedBaseCents < 0 || currentBaseCents < 0 || previouslyAllocatedVatCents < 0) {
    throw new RangeError("VAT slice inputs must be non-negative and the contract base must be positive");
  }
  const cumulativeBase = BigInt(previouslyAllocatedBaseCents + currentBaseCents);
  if (cumulativeBase > BigInt(contractBaseCents)) throw new RangeError("allocated base exceeds the contract");
  const numerator = BigInt(contractVatCents) * cumulativeBase;
  const denominator = BigInt(contractBaseCents);
  const cumulativeTax = Number((numerator * BigInt(2) + denominator) / (BigInt(2) * denominator));
  const result = cumulativeTax - previouslyAllocatedVatCents;
  if (result < 0 || result > contractVatCents - previouslyAllocatedVatCents) throw new RangeError("VAT slice is outside the remaining contract tax");
  return result;
}
