import assert from "node:assert/strict";
import { test } from "node:test";

import {
  effectiveMarkupPercent,
  finalPriceConsistent,
  markupForCost,
  nextFinalPrice,
  printMarginFromCost,
  printMarkupFromCost,
  printSellingPriceFromCost,
  projectBalance,
  recommendedFromCost,
} from "../../src/lib/billing-v2/pricing.ts";

test("markup bands on Total Cost", () => {
  assert.equal(printMarkupFromCost(0), 0.5);
  assert.equal(printMarkupFromCost(40), 0.5);
  assert.equal(printMarkupFromCost(50), 0.5);
  assert.equal(printMarkupFromCost(50.01), 0.4);
  assert.equal(printMarkupFromCost(100), 0.4);
  assert.equal(printMarkupFromCost(100.01), 0.3);
  // The V2 screens read the same band under its old name.
  assert.equal(printMarginFromCost(80), 0.4);
});

test("Recommended = Cost × (1 + markup), not cost ÷ (1 − margin)", () => {
  const cases: [number, number][] = [
    [40, 60],
    [50, 75],
    [50.01, 70.01],
    [80, 112],
    [100, 140],
    [100.01, 130.01],
    [150, 195],
  ];
  for (const [cost, expected] of cases) {
    assert.equal(printSellingPriceFromCost(cost), expected, `cost ${cost}`);
  }
});

test("the recommendation is not rounded up to a $5 step", () => {
  assert.equal(printSellingPriceFromCost(80), 112);
  assert.equal(printSellingPriceFromCost(33.33), 50);
  assert.equal(printSellingPriceFromCost(12.34), 18.51);
});

test("an edited markup recalculates the recommendation", () => {
  assert.equal(recommendedFromCost(40, 0.35), 54);
  assert.equal(recommendedFromCost(40, 0), 40);
  assert.equal(recommendedFromCost(150, 0.5), 225);
});

test("nonsense costs price at zero rather than NaN", () => {
  assert.equal(printSellingPriceFromCost(Number.NaN), 0);
  assert.equal(printSellingPriceFromCost(-1), 0);
});

test("a cost change follows the recommendation until someone sets a price", () => {
  assert.equal(nextFinalPrice({ cost: 20, manual: false, currentFinal: 10 }), 30);
  assert.equal(nextFinalPrice({ cost: 20, manual: true, currentFinal: 15 }), 15);
  assert.equal(nextFinalPrice({ cost: null, manual: false, currentFinal: 25 }), 25);
});

test("a $4.3*150 cost (=$645) recommends $838.50, and a manual override survives it", () => {
  assert.equal(printSellingPriceFromCost(645), 838.5);
  assert.equal(nextFinalPrice({ cost: 645, manual: false, currentFinal: 0 }), 838.5);
  assert.equal(nextFinalPrice({ cost: 645, manual: true, currentFinal: 700 }), 700);
});

test("effective markup is (Final − Cost) ÷ Cost", () => {
  assert.equal(effectiveMarkupPercent(55, 40), 37.5);
  assert.equal(effectiveMarkupPercent(60, 40), 50);
  assert.equal(effectiveMarkupPercent(30, 40), -25);
  assert.equal(effectiveMarkupPercent(55, 0), null);
  assert.equal(effectiveMarkupPercent(null, 40), null);
});

test("a final unit price and total belong together at a quantity", () => {
  assert.equal(finalPriceConsistent(180, 4.3, 774), true);
  assert.equal(finalPriceConsistent(181, 4.3, 778.3), true);
  assert.equal(finalPriceConsistent(3, 18.33, 55), true); // typed total
  assert.equal(finalPriceConsistent(3, 18.33, 54.99), true); // typed unit
  assert.equal(finalPriceConsistent(180, 4.3, 800), false);
  assert.equal(finalPriceConsistent(0, 4.3, 0), false);
});

test("deposit: none, partial, paid in full, overpaid", () => {
  assert.deepEqual(projectBalance(650, null), { finalTotal: 650, deposit: 0, remaining: 650, overpaid: 0, settled: false });
  assert.deepEqual(projectBalance(650, 0), { finalTotal: 650, deposit: 0, remaining: 650, overpaid: 0, settled: false });
  assert.deepEqual(projectBalance(650, 200), { finalTotal: 650, deposit: 200, remaining: 450, overpaid: 0, settled: false });
  assert.deepEqual(projectBalance(650, 650), { finalTotal: 650, deposit: 650, remaining: 0, overpaid: 0, settled: true });
  assert.deepEqual(projectBalance(650, 700), { finalTotal: 650, deposit: 700, remaining: 0, overpaid: 50, settled: true });
});

test("a deposit never changes a price", () => {
  const before = printSellingPriceFromCost(40);
  projectBalance(before, 1000);
  assert.equal(printSellingPriceFromCost(40), 60);
});

test("a line's manual markup override replaces the band; null keeps the band", () => {
  assert.equal(markupForCost(40, 35), 0.35);
  assert.equal(markupForCost(40, null), 0.5);
  assert.equal(markupForCost(40, undefined), 0.5);
  assert.equal(markupForCost(150, 0), 0);
  assert.equal(printSellingPriceFromCost(40, 35), 54);
  assert.equal(printSellingPriceFromCost(80, 35), 108);
  assert.equal(printSellingPriceFromCost(80, null), 112);
});
