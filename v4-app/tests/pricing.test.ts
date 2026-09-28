import assert from "node:assert/strict";
import test from "node:test";

import { calculateBillingLine, markupFromCost, projectBalance, recommendedTotal } from "../src/domain/pricing.ts";

test("markup bands follow the V3 business rule boundaries", () => {
  assert.equal(markupFromCost(50), 0.5);
  assert.equal(markupFromCost(50.01), 0.4);
  assert.equal(markupFromCost(100), 0.4);
  assert.equal(markupFromCost(100.01), 0.3);
});

test("row markup override controls recommendation", () => {
  assert.equal(recommendedTotal(80), 112);
  assert.equal(recommendedTotal(80, 35), 108);
});

test("manual final unit is preserved when quantity changes", () => {
  const line = calculateBillingLine({
    quantity: 7,
    unitCostUsd: 10,
    markupOverridePercent: null,
    finalMode: "UNIT",
    currentFinalUnitUsd: 17.25,
    currentFinalTotalUsd: null,
  });
  assert.equal(line.finalUnitUsd, 17.25);
  assert.equal(line.finalTotalUsd, 120.75);
  assert.equal(line.recommendedTotalUsd, 98);
});

test("Use Recommended explicitly resets final price", () => {
  const line = calculateBillingLine({
    quantity: 2,
    unitCostUsd: 20,
    markupOverridePercent: null,
    finalMode: "AUTO",
    currentFinalUnitUsd: 999,
    currentFinalTotalUsd: 999,
  });
  assert.equal(line.recommendedTotalUsd, 60);
  assert.equal(line.finalTotalUsd, 60);
  assert.equal(line.finalUnitUsd, 30);
});

test("deposit changes remaining, never final total", () => {
  assert.deepEqual(projectBalance(500, 125), { finalTotal: 500, deposit: 125, remaining: 375, overpaid: 0 });
  assert.deepEqual(projectBalance(500, 525), { finalTotal: 500, deposit: 525, remaining: 0, overpaid: 25 });
});
