import assert from "node:assert/strict";
import { test } from "node:test";

import {
  nextFinalPrice,
  printMarginFromCost,
  printSellingPriceFromCost,
} from "../../src/lib/billing-v2/pricing.ts";

test("margin bands", () => {
  assert.equal(printMarginFromCost(0), 0.5);
  assert.equal(printMarginFromCost(50), 0.5);
  assert.equal(printMarginFromCost(50.01), 0.4);
  assert.equal(printMarginFromCost(100), 0.4);
  assert.equal(printMarginFromCost(100.01), 0.3);
});

test("the recommended price rounds up to the next $5", () => {
  const cases: [number, number][] = [
    [5, 10],
    [20, 40],
    [50, 100],
    [60, 100],
    [101, 145],
  ];
  for (const [cost, expected] of cases) {
    assert.equal(printSellingPriceFromCost(cost), expected, `cost ${cost}`);
  }
});

test("a price already on a $5 step is not pushed to the next one", () => {
  assert.equal(printSellingPriceFromCost(50), 100);
  assert.equal(printSellingPriceFromCost(20), 40);
  assert.equal(printSellingPriceFromCost(15), 30);
});

test("nonsense costs price at zero rather than NaN", () => {
  assert.equal(printSellingPriceFromCost(Number.NaN), 0);
  assert.equal(printSellingPriceFromCost(-1), 0);
});

test("a cost change follows the recommendation until someone sets a price", () => {
  assert.equal(nextFinalPrice({ cost: 20, manual: false, currentFinal: 10 }), 40);
  assert.equal(nextFinalPrice({ cost: 20, manual: true, currentFinal: 15 }), 15);
  assert.equal(nextFinalPrice({ cost: null, manual: false, currentFinal: 25 }), 25);
});
