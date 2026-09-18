import assert from "node:assert/strict";
import { test } from "node:test";

import {
  blankDraft,
  draftFinal,
  draftFromItem,
  draftIsComplete,
  draftRecommended,
  draftTotalCost,
  draftUnitCost,
  withQuantity,
  withTotalCost,
  withUnitCost,
  type ItemDraft,
} from "../../src/components/billing-v2/item-draft.ts";

function draft(finalPrice: string) {
  return {
    ...blankDraft(),
    description: "Price pending line",
    finalPrice,
  };
}

test("a blank final price is saveable as NULL", () => {
  assert.equal(draftIsComplete(draft("")), true);
});

test("an explicit zero price is complete", () => {
  assert.equal(draftIsComplete(draft("0")), true);
});

test("an invalid entered price is not complete", () => {
  assert.equal(draftIsComplete(draft("-1")), false);
});

// --- Printing cost: Unit Cost and Total Cost are two views of one number ---

function printingDraft(quantity = "150") {
  return { ...blankDraft("PRINTING"), quantity };
}

/** A minimal BoardItem-shaped fixture — the `type` import it's checked against is erased at runtime. */
function boardItem(overrides: Record<string, unknown>) {
  return {
    item: { id: "item-1", quantity: 900, printCost: 30, ...(overrides.item as object) },
    service: { key: "PRINTING", labelKey: "v2.service.PRINTING", storageType: "PRINT", pricing: "cost", offered: true },
    cost: 30,
    unitCost: 30 / 900,
    recommended: 60,
    margin: 0.5,
    manual: false,
    amount: 60,
    ...overrides,
  } as unknown as Parameters<typeof draftFromItem>[0];
}

test("typing a Unit Cost computes Total Cost from Qty × Unit", () => {
  const next = withUnitCost(printingDraft("150"), "4.30");
  assert.equal(draftTotalCost(next), 645);
  assert.equal(draftUnitCost(next), 4.3);
  assert.equal(draftRecommended(next), 925);
});

test("typing a Total Cost derives Unit Cost as Total ÷ Qty", () => {
  const next = withTotalCost(printingDraft("900"), "30");
  assert.equal(draftTotalCost(next), 30);
  assert.equal(draftUnitCost(next), 30 / 900);
  assert.equal(draftRecommended(next), 60);
});

test("a quantity change in Unit Cost mode recomputes Total Cost, not Unit Cost", () => {
  const unit = withUnitCost(printingDraft("100"), "2");
  assert.equal(draftTotalCost(unit), 200);

  const requantified = withQuantity(unit, "150");
  assert.equal(draftUnitCost(requantified), 2);
  assert.equal(draftTotalCost(requantified), 300);
  assert.equal(draftRecommended(requantified), 430);
});

test("a quantity change in Total Cost mode holds Total Cost and recomputes Unit Cost", () => {
  const total = withTotalCost(printingDraft("100"), "200");
  assert.equal(draftUnitCost(total), 2);
  const recommendedBefore = draftRecommended(total);

  const requantified = withQuantity(total, "200");
  assert.equal(draftTotalCost(requantified), 200);
  assert.equal(draftUnitCost(requantified), 1);
  // Total Cost never moved, so the recommendation it drives doesn't either.
  assert.equal(draftRecommended(requantified), recommendedBefore);
});

test("a manual override survives a later Unit Cost and quantity change", () => {
  const priced = withUnitCost(printingDraft("150"), "4.30");
  assert.equal(draftRecommended(priced), 925);

  const overridden: ItemDraft = { ...priced, finalPrice: "950", priceTouched: true };
  const requantified = withQuantity(overridden, "200");
  assert.equal(draftTotalCost(requantified), 860);
  assert.equal(draftRecommended(requantified), 1230);
  assert.equal(draftFinal(requantified), 950);
});

test("existing printing rows keep Unit Cost fixed when Qty changes", () => {
  const fromStoredData = draftFromItem(boardItem({}));
  assert.equal(fromStoredData.costMode, "UNIT");
  assert.equal(draftTotalCost(fromStoredData), 30);
  assert.equal(draftUnitCost(fromStoredData), 30 / 900);
  // Opening a line for edit must never itself change what was already saved.
  assert.equal(draftFinal(fromStoredData), 60);

  const requantified = withQuantity(fromStoredData, "1800");
  assert.equal(draftUnitCost(requantified), 30 / 900);
  assert.equal(draftTotalCost(requantified), 60);
  assert.equal(draftRecommended(requantified), 100);
});
