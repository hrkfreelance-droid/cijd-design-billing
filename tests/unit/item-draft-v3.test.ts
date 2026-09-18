import assert from "node:assert/strict";
import { test } from "node:test";

import {
  draftFinal,
  draftFromItem,
  draftRecommended,
  draftTotalCost,
  draftUnitCost,
  withQuantity,
  withUnitCost,
  type ItemDraft,
} from "../../src/components/billing-v3/item-draft.ts";

function boardItem() {
  return {
    item: {
      id: "printing-1",
      quantity: 180,
      printCost: 360,
      description: "Printing",
    },
    service: {
      key: "PRINTING",
      labelKey: "v2.service.PRINTING",
      storageType: "PRINT",
      pricing: "cost",
      offered: true,
    },
    cost: 360,
    unitCost: 2,
    recommended: 515,
    margin: 0.3,
    manual: false,
    amount: 515,
  } as unknown as Parameters<typeof draftFromItem>[0];
}

test("V3 derives Unit Cost once from stored Qty and Total Cost", () => {
  const draft = draftFromItem(boardItem());
  assert.equal(draft.quantity, "180");
  assert.equal(draftUnitCost(draft), 2);
  assert.equal(draftTotalCost(draft), 360);
});

test("V3 Qty 180 -> 200 keeps Unit Cost 2 and makes Total Cost 400", () => {
  const draft = draftFromItem(boardItem());
  const changed = withQuantity(draft, "200");
  assert.equal(draftUnitCost(changed), 2);
  assert.equal(draftTotalCost(changed), 400);
  assert.equal(changed.totalCost, "400");
  assert.equal(draftRecommended(changed), 575);
  assert.equal(draftFinal(changed), 575);
});

test("V3 Unit Cost is manual and Total Cost follows Qty × Unit Cost", () => {
  const draft = draftFromItem(boardItem());
  const changed = withUnitCost(draft, "1.80");
  assert.equal(draftUnitCost(changed), 1.8);
  assert.equal(draftTotalCost(changed), 324);
});

test("V3 manual Final Billing survives Qty and Unit Cost changes", () => {
  const draft = {
    ...draftFromItem(boardItem()),
    finalPrice: "515",
    priceTouched: true,
  } satisfies ItemDraft;
  const changed = withQuantity(draft, "200");
  assert.equal(draftTotalCost(changed), 400);
  assert.equal(draftRecommended(changed), 575);
  assert.equal(draftFinal(changed), 515);
});
