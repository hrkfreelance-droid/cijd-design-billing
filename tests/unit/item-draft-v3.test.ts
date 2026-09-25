import assert from "node:assert/strict";
import { test } from "node:test";

import {
  draftChanged,
  draftErrors,
  draftFinal,
  draftFinalUnit,
  draftFromItem,
  draftIsManual,
  draftMarkup,
  draftMarkupOverride,
  draftRecommended,
  draftTotalCost,
  draftUnitCost,
  withDefaultMarkup,
  withFinalTotal,
  withFinalUnit,
  withMarkup,
  withQuantity,
  withRecommended,
  withUnitCost,
  type ItemDraft,
} from "../../src/components/billing-v3/item-draft.ts";
import { toBoardItem } from "../../src/lib/billing-v2/board.ts";
import { effectiveMarkupPercent } from "../../src/lib/billing-v2/pricing.ts";
import type { BillingItem } from "../../src/lib/types.ts";

function printItem(overrides: Partial<BillingItem> = {}): BillingItem {
  return {
    id: "printing-1",
    projectId: "project-1",
    description: "Printing",
    type: "PRINT",
    serviceType: "PRINTING",
    quantity: 180,
    unitPrice: 2.6,
    amount: 468,
    customAmount: false,
    productionStatus: "IN_PROGRESS",
    billingStatus: "NOT_READY",
    printCost: 360,
    createdAt: "2026-09-01T00:00:00.000Z",
    createdBy: "Designer",
    updatedAt: "2026-09-01T00:00:00.000Z",
    updatedBy: "Designer",
    ...overrides,
  };
}

/** An editor line opened on a stored item. */
function open(overrides: Partial<BillingItem> = {}): ItemDraft {
  return draftFromItem(toBoardItem(printItem(overrides)));
}

// ---- Cost ---------------------------------------------------------------

test("V3 derives Unit Cost once from stored Qty and Total Cost", () => {
  const draft = open();
  assert.equal(draft.quantity, "180");
  assert.equal(draftUnitCost(draft), 2);
  assert.equal(draftTotalCost(draft), 360);
});

test("V3 Unit Cost is manual and Total Cost follows Qty × Unit Cost", () => {
  const changed = withUnitCost(open(), "1.80");
  assert.equal(draftUnitCost(changed), 1.8);
  assert.equal(draftTotalCost(changed), 324);
});

test("V3 Qty 180 -> 181 with Unit Cost 4.30 makes Total Cost 778.30", () => {
  const draft = { ...open(), unitCost: "4.30", totalCost: "774" } satisfies ItemDraft;
  const changed = withQuantity(draft, "181");
  assert.equal(draftUnitCost(changed), 4.3);
  assert.equal(draftTotalCost(changed), 778.3);
  assert.equal(changed.totalCost, "778.3");
});

test("an expression cost `4.3*150` is the number 645, never the formula", () => {
  const draft = withQuantity(withUnitCost(open(), "4.3*150"), "1");
  assert.equal(draftUnitCost(draft), 645);
  assert.equal(draftTotalCost(draft), 645);
  assert.equal(draftRecommended(draft), 838.5);
});

// ---- Default markup and Recommended -------------------------------------

test("default markup follows the Total Cost band", () => {
  const cases: [string, number][] = [
    ["40", 0.5],
    ["50", 0.5],
    ["50.01", 0.4],
    ["100", 0.4],
    ["100.01", 0.3],
  ];
  for (const [cost, markup] of cases) {
    const draft = withUnitCost(withQuantity(open(), "1"), cost);
    assert.equal(draftMarkup(draft), markup, `cost ${cost}`);
  }
});

test("a line at its recommendation follows the cost (AUTO)", () => {
  const draft = open(); // 360 → +30% → 468, stored 468
  assert.equal(draft.finalMode, "AUTO");
  assert.equal(draftIsManual(draft), false);
  const changed = withQuantity(draft, "200"); // cost 400 → 520
  assert.equal(draftTotalCost(changed), 400);
  assert.equal(draftRecommended(changed), 520);
  assert.equal(draftFinal(changed), 520);
  assert.equal(draftFinalUnit(changed), 2.6);
});

// ---- Manual markup -------------------------------------------------------

test("an edited markup recalculates Recommended, and AUTO Final follows it", () => {
  const draft = withUnitCost(withQuantity(open(), "1"), "40"); // default 50% → 60
  assert.equal(draftRecommended(draft), 60);
  const edited = withMarkup(draft, "35");
  assert.equal(edited.markupTouched, true);
  assert.equal(draftMarkup(edited), 0.35);
  assert.equal(draftRecommended(edited), 54);
  assert.equal(draftFinal(edited), 54);
  assert.equal(edited.finalMode, "AUTO");
});

test("an edited markup survives a cost change; Use default returns to the band", () => {
  const edited = withMarkup(withUnitCost(withQuantity(open(), "1"), "40"), "35");
  const moved = withUnitCost(edited, "150");
  assert.equal(draftMarkup(moved), 0.35);
  assert.equal(draftRecommended(moved), 202.5);
  const reset = withDefaultMarkup(moved);
  assert.equal(reset.markupTouched, false);
  assert.equal(reset.markup, "30");
  assert.equal(draftRecommended(reset), 195);
  assert.equal(draftFinal(reset), 195);
});

test("an edited markup never moves a manual Final", () => {
  const manual = withFinalTotal(withUnitCost(withQuantity(open(), "1"), "40"), "55");
  const edited = withMarkup(manual, "80");
  assert.equal(draftRecommended(edited), 72);
  assert.equal(draftFinal(edited), 55);
  assert.equal(draftIsManual(edited), true);
});

test("an invalid markup is flagged and Recommended falls back to the band", () => {
  const edited = withMarkup(withUnitCost(withQuantity(open(), "1"), "40"), "-5");
  assert.ok(draftErrors(edited).has("markup"));
  assert.equal(draftRecommended(edited), 60);
});

// ---- Final Total override -------------------------------------------------

test("Final Total typed directly: unit derived, effective markup derived, Recommended untouched", () => {
  const draft = withUnitCost(withQuantity(open(), "1"), "40");
  const typed = withFinalTotal(draft, "55");
  assert.equal(typed.finalMode, "TOTAL");
  assert.equal(draftIsManual(typed), true);
  assert.equal(draftFinal(typed), 55);
  assert.equal(draftFinalUnit(typed), 55);
  assert.equal(draftRecommended(typed), 60);
  assert.equal(effectiveMarkupPercent(draftFinal(typed), draftTotalCost(typed)), 37.5);
});

test("Final Total ÷ Qty rounds the unit price to the cent", () => {
  const draft = withQuantity(withUnitCost(open(), "10"), "3");
  const typed = withFinalTotal(draft, "55");
  assert.equal(draftFinal(typed), 55);
  assert.equal(draftFinalUnit(typed), 18.33);
});

test("Final Total accepts an expression and uses its value", () => {
  const typed = withFinalTotal(withQuantity(open(), "150"), "4.3*150");
  assert.equal(draftFinal(typed), 645);
  assert.equal(draftFinalUnit(typed), 4.3);
});

test("a cost change never overwrites a manual Final", () => {
  const typed = withFinalTotal(withUnitCost(withQuantity(open(), "1"), "40"), "55");
  const moved = withUnitCost(typed, "80");
  assert.equal(draftRecommended(moved), 112);
  assert.equal(draftFinal(moved), 55);
});

// ---- Final Unit Price override and the Qty regression ---------------------

function manualUnit(): ItemDraft {
  return withFinalUnit(open(), "4.30");
}

test("Final Unit Price sets the total: $4.30 × 180 = $774", () => {
  const draft = manualUnit();
  assert.equal(draft.finalMode, "UNIT");
  assert.equal(draftFinalUnit(draft), 4.3);
  assert.equal(draftFinal(draft), 774);
});

test("REGRESSION Qty 180 → 181 keeps the manual unit price $4.30; total $778.30", () => {
  const changed = withQuantity(manualUnit(), "181");
  assert.equal(draftFinalUnit(changed), 4.3);
  assert.equal(changed.finalUnitPrice, "4.30");
  assert.equal(draftFinal(changed), 778.3);
});

test("REGRESSION Qty 180 → 200 keeps the manual unit price $4.30; total $860", () => {
  const changed = withQuantity(manualUnit(), "200");
  assert.equal(draftFinalUnit(changed), 4.3);
  assert.equal(changed.finalUnitPrice, "4.30");
  assert.equal(draftFinal(changed), 860);
});

test("REGRESSION a stored manual price reopens as a fixed unit price", () => {
  // Saved as 180 × $4.30 = $774 against a $468 recommendation.
  const draft = open({ amount: 774, unitPrice: 4.3, customAmount: true });
  assert.equal(draft.finalMode, "UNIT");
  for (const [qty, total] of [["181", 778.3], ["200", 860]] as const) {
    const changed = withQuantity(draft, qty);
    assert.equal(draftFinalUnit(changed), 4.3, `qty ${qty}`);
    assert.equal(draftFinal(changed), total, `qty ${qty}`);
  }
});

test("a typed Final Total becomes a fixed unit price once Qty changes", () => {
  const typed = withFinalTotal(withQuantity(open(), "180"), "774");
  const changed = withQuantity(typed, "200");
  assert.equal(changed.finalMode, "UNIT");
  assert.equal(draftFinalUnit(changed), 4.3);
  assert.equal(draftFinal(changed), 860);
});

test("the manual unit price survives many Qty edits without drifting", () => {
  let draft = manualUnit();
  for (const qty of ["181", "1", "7", "999", "200", "180"]) draft = withQuantity(draft, qty);
  assert.equal(draftFinalUnit(draft), 4.3);
  assert.equal(draftFinal(draft), 774);
});

test("Use recommended is the only way back to AUTO", () => {
  const manual = withQuantity(manualUnit(), "200");
  assert.equal(draftIsManual(manual), true);
  const back = withRecommended(manual);
  assert.equal(back.finalMode, "AUTO");
  assert.equal(draftFinal(back), draftRecommended(back));
});

// ---- Existing data ------------------------------------------------------

test("an existing price from the old rule opens unchanged and as manual", () => {
  // Priced under the old margin rule: cost $40 → $80. Today's rule says $60.
  const draft = open({ quantity: 1, printCost: 40, amount: 80, unitPrice: 80 });
  assert.equal(draftFinal(draft), 80);
  assert.equal(draftRecommended(draft), 60);
  assert.equal(draftIsManual(draft), true);
  assert.equal(draftChanged(draft), false);
});

test("opening and not touching a line is not a change", () => {
  assert.equal(draftChanged(open()), false);
  assert.equal(draftChanged(open({ amount: 774, unitPrice: 4.3, customAmount: true })), false);
});

test("a new unit price at the same total is still a change", () => {
  const draft = open({ quantity: 3, printCost: 30, amount: 55, unitPrice: 18.33, customAmount: true });
  const retyped = withFinalUnit(draft, "18.34");
  assert.equal(draftChanged(retyped), true);
});

// ---- Persisted manual markup --------------------------------------------

test("a stored markup override reopens as the line's own markup: 35% · Manual", () => {
  // $40 cost, saved at +35% → $54.
  const draft = open({ quantity: 1, printCost: 40, amount: 54, unitPrice: 54, markupOverride: 35 });
  assert.equal(draft.markup, "35");
  assert.equal(draft.markupTouched, true);
  assert.equal(draftMarkup(draft), 0.35);
  assert.equal(draftRecommended(draft), 54);
  assert.equal(draftMarkupOverride(draft), 35);
  // It still follows its (own) recommendation, and opening it is not a change.
  assert.equal(draft.finalMode, "AUTO");
  assert.equal(draftChanged(draft), false);
});

test("with a stored 35% markup, a later cost change recommends cost × 1.35", () => {
  const draft = open({ quantity: 1, printCost: 40, amount: 54, unitPrice: 54, markupOverride: 35 });
  const moved = withUnitCost(draft, "80");
  assert.equal(draftMarkup(moved), 0.35);
  assert.equal(moved.markup, "35");
  assert.equal(draftRecommended(moved), 108);
  assert.equal(draftFinal(moved), 108);
});

test("default 50% → manual 35% is a change to save; Use default clears it", () => {
  const draft = open({ quantity: 1, printCost: 40, amount: 60, unitPrice: 60 });
  assert.equal(draftMarkupOverride(draft), null);
  const edited = withMarkup(draft, "35");
  assert.equal(draftMarkupOverride(edited), 35);
  assert.equal(draftChanged(edited), true);
  const stored = open({ quantity: 1, printCost: 80, amount: 108, unitPrice: 108, markupOverride: 35 });
  const reset = withDefaultMarkup(stored);
  assert.equal(draftMarkupOverride(reset), null);
  assert.equal(reset.markup, "40");
  assert.equal(draftRecommended(reset), 112);
  assert.equal(draftChanged(reset), true);
});

test("a manual Final stays independent of a stored markup", () => {
  const draft = open({ quantity: 180, printCost: 360, amount: 774, unitPrice: 4.3, markupOverride: 35 });
  assert.equal(draft.finalMode, "UNIT");
  assert.equal(draftRecommended(draft), 486);
  const moved = withQuantity(draft, "200");
  assert.equal(draftFinalUnit(moved), 4.3);
  assert.equal(draftFinal(moved), 860);
  assert.equal(draftRecommended(moved), 540); // $400 × 1.35
});

test("rows without a markup override keep the band and are unchanged", () => {
  const draft = open(); // markupOverride absent (NULL)
  assert.equal(draft.markupTouched, false);
  assert.equal(draftMarkupOverride(draft), null);
  assert.equal(draftChanged(draft), false);
});
