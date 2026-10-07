import assert from "node:assert/strict";
import { test } from "node:test";

import {
  changeCost,
  changeMarkup,
  changeQuantity,
  hasErrors,
  invoiceUnitPrice,
  lineRecommended,
  nextTaxInvoiceNumber,
  projectPaymentsWithLegacyDeposit,
  resolveFinalMode,
  roundMoney,
  setManualTotal,
  setManualUnit,
  settlement,
  taxTotals,
  toCents,
  applyRecommended,
  validateLine,
  validatePayment,
  type LineState,
} from "../../src/lib/billing-v5/calculation.ts";

function printLine(cost: number, quantity = 1): LineState {
  return applyRecommended({
    costPriced: true,
    quantity,
    costTotal: cost,
    markupOverridePercent: null,
    finalMode: "AUTO",
    finalUnit: null,
    finalTotal: null,
  });
}

test("markup bands: 40→60, 50→75, 80→112, 100→140, 120→156", () => {
  for (const [cost, expected] of [
    [40, 60],
    [50, 75],
    [80, 112],
    [100, 140],
    [120, 156],
  ] as const) {
    const line = printLine(cost);
    assert.equal(lineRecommended(line), expected, `cost ${cost}`);
    assert.equal(line.finalTotal, expected, `AUTO Final follows at cost ${cost}`);
  }
});

test("markup override is deterministic and survives a JSON round trip (reload)", () => {
  const line = changeMarkup(printLine(80), 35);
  assert.equal(lineRecommended(line), 108); // $80 × 1.35
  const reloaded = JSON.parse(JSON.stringify(line)) as LineState;
  assert.equal(reloaded.markupOverridePercent, 35);
  assert.equal(lineRecommended(reloaded), 108);
  // Same input, same result, however it is reached.
  assert.equal(lineRecommended(changeMarkup(changeCost(printLine(10), 80), 35)), 108);
  // Back to the band.
  assert.equal(lineRecommended(changeMarkup(line, null)), 112);
});

test("manual Final protection: Recommended 156, Manual 150 survives cost, markup and quantity changes", () => {
  let line = setManualTotal(printLine(120), 150);
  assert.equal(lineRecommended(line), 156);
  assert.equal(line.finalMode, "MANUAL");
  assert.equal(line.finalTotal, 150);

  line = changeCost(line, 130);
  assert.equal(lineRecommended(line), 169);
  assert.equal(line.finalTotal, 150);

  line = changeMarkup(line, 60);
  assert.equal(line.finalTotal, 150);

  // Quantity keeps the Unit Final: 150 stays 150 per unit.
  line = changeQuantity(line, 2);
  assert.equal(line.finalUnit, 150);
  assert.equal(line.finalTotal, 300);
  assert.equal(line.finalMode, "MANUAL");
});

test("a manual Final equal to Recommended is still MANUAL", () => {
  let line = setManualTotal(printLine(120), 156);
  assert.equal(line.finalMode, "MANUAL");
  line = changeCost(line, 200);
  assert.equal(line.finalTotal, 156);
});

test("quantity: Unit Final 305 × 2 = 610, × 3 = 915, Unit Final unchanged", () => {
  let line: LineState = setManualUnit(
    { costPriced: false, quantity: 2, costTotal: null, markupOverridePercent: null, finalMode: "MANUAL", finalUnit: null, finalTotal: null },
    305,
  );
  assert.equal(line.finalTotal, 610);
  line = changeQuantity(line, 3);
  assert.equal(line.finalUnit, 305);
  assert.equal(line.finalTotal, 915);
});

test("AUTO reset: Use Recommended returns to AUTO and then follows cost", () => {
  let line = setManualTotal(printLine(120), 150);
  line = applyRecommended(line);
  assert.equal(line.finalMode, "AUTO");
  assert.equal(line.finalTotal, 156);
  line = changeCost(line, 80);
  assert.equal(lineRecommended(line), 112);
  assert.equal(line.finalTotal, 112);
});

test("payments: 1200 − deposit 500 = 700; + payment 300 = 400; identical after reload", () => {
  const payments = [{ amount: 500, kind: "DEPOSIT" }];
  let result = settlement(1200, payments);
  assert.deepEqual(result, { finalTotal: 1200, paid: 500, balance: 700, overpaid: 0, status: "PARTIALLY_PAID" });
  payments.push({ amount: 300, kind: "PARTIAL" });
  result = settlement(1200, payments);
  assert.equal(result.balance, 400);
  assert.deepEqual(settlement(1200, JSON.parse(JSON.stringify(payments))), result);
  // Paid in full, overpaid, voided.
  assert.equal(settlement(1200, [...payments, { amount: 400, kind: "FINAL" }]).status, "PAID");
  assert.equal(settlement(1200, [...payments, { amount: 500, kind: "FINAL" }]).overpaid, 100);
  assert.equal(settlement(1200, [{ amount: 500, voidedAt: "2026-09-29" }]).balance, 1200);
});

test("a V3 deposit is one payment in the same balance", () => {
  const all = projectPaymentsWithLegacyDeposit({ id: "p1", depositAmount: 500 }, [
    { projectId: "p1", amount: 300 },
    { projectId: "other", amount: 999 },
  ]);
  assert.equal(all.length, 2);
  assert.equal(settlement(1200, all).balance, 400);
  assert.equal(projectPaymentsWithLegacyDeposit({ id: "p1", depositAmount: null }, []).length, 0);
});

test("tax: subtotal, VAT 10%, grand total USD and KHR reconcile exactly", () => {
  const totals = taxTotals({ lines: [{ amount: 610 }, { amount: 156 }], vatApplicable: true, exchangeRate: 4105 });
  assert.deepEqual(totals, { subtotalUsd: 766, vatPercent: 10, vatUsd: 76.6, totalUsd: 842.6, totalKhr: 3458873 });
});

test("rounding edge case: every layer agrees to the cent", () => {
  // Qty 3 at a typed total of $100 → unit $33.33; the line amount stays $100.
  const line = setManualTotal(
    { costPriced: false, quantity: 3, costTotal: null, markupOverridePercent: null, finalMode: "MANUAL", finalUnit: null, finalTotal: null },
    100,
  );
  assert.equal(line.finalUnit, 33.33);
  assert.equal(line.finalTotal, 100);
  assert.equal(invoiceUnitPrice({ quantity: 3, unitPrice: line.finalUnit, amount: 100 }), 33.33);

  // A cost-priced line whose recommendation has a half cent: $10.01 × 1.5 = 15.015 → 15.02.
  const printed = printLine(10.01);
  assert.equal(printed.finalTotal, 15.02);

  const lines = [{ amount: line.finalTotal! }, { amount: printed.finalTotal! }, { amount: 0.05 }];
  const estimateTotal = roundMoney(lines.reduce((sum, entry) => sum + entry.amount, 0));
  assert.equal(estimateTotal, 115.07);

  const balance = settlement(estimateTotal, [{ amount: 50.035 }]); // a typed half cent rounds once
  assert.equal(balance.paid, 50.04);
  assert.equal(balance.balance, 65.03);
  assert.equal(toCents(balance.paid) + toCents(balance.balance), toCents(estimateTotal));

  const tax = taxTotals({ lines, vatApplicable: true, exchangeRate: 4103.5 });
  assert.equal(tax.subtotalUsd, estimateTotal);
  assert.equal(tax.vatUsd, 11.51); // 11.507 → 11.51
  assert.equal(tax.totalUsd, 126.58);
  assert.equal(toCents(tax.subtotalUsd) + toCents(tax.vatUsd), toCents(tax.totalUsd));
  assert.equal(tax.totalKhr, 519421); // 126.58 × 4103.5 = 519,421.03 → 519,421
});

test("VAT not applicable: 0% and totals still reconcile", () => {
  const tax = taxTotals({ lines: [{ amount: 100 }], vatApplicable: false, exchangeRate: 4100 });
  assert.deepEqual(tax, { subtotalUsd: 100, vatPercent: 0, vatUsd: 0, totalUsd: 100, totalKhr: 410000 });
});

test("final mode of existing rows is read the V3 way, never rewritten", () => {
  assert.equal(resolveFinalMode({ costPriced: true, amount: 60, recommended: 60 }), "AUTO");
  assert.equal(resolveFinalMode({ costPriced: true, amount: 80, recommended: 60 }), "MANUAL");
  assert.equal(resolveFinalMode({ finalMode: "MANUAL", costPriced: true, amount: 60, recommended: 60 }), "MANUAL");
  assert.equal(resolveFinalMode({ finalMode: "AUTO", costPriced: false, amount: 60, recommended: null }), "MANUAL");
});

test("validation separates blocking errors from warnings", () => {
  const base = { costPriced: true, quantity: 1, costTotal: 40, markupOverridePercent: null, finalMode: "AUTO" as const, finalUnit: 60, finalTotal: 60 };
  assert.deepEqual(validateLine(base), []);
  assert.ok(hasErrors(validateLine({ ...base, quantity: -1 })));
  assert.ok(hasErrors(validateLine({ ...base, quantity: Number.NaN })));
  assert.ok(hasErrors(validateLine({ ...base, finalTotal: Number.POSITIVE_INFINITY })));
  assert.ok(hasErrors(validateLine({ ...base, costTotal: null })));
  assert.ok(hasErrors(validateLine({ ...base, markupOverridePercent: -5 })));
  const zero = validateLine({ ...base, finalMode: "MANUAL", finalTotal: 0, finalUnit: 0 });
  assert.equal(hasErrors(zero), false);
  assert.ok(zero.some((issue) => issue.code === "FINAL_ZERO"));
  assert.ok(validateLine({ ...base, finalMode: "MANUAL", quantity: 170, finalUnit: 1.79, finalTotal: 305 }).some((i) => i.code === "UNIT_TIMES_QTY_DIFFERS"));
  assert.deepEqual(validatePayment(300, 700), []);
  assert.equal(validatePayment(800, 700)[0].level, "WARNING");
  assert.equal(validatePayment(0, 700)[0].level, "ERROR");
});

test("invoice numbers derive from stored history", () => {
  assert.equal(nextTaxInvoiceNumber(2026, []), "CIJDTI2026001");
  assert.equal(nextTaxInvoiceNumber(2026, ["CIJDTI2026081", "CIJDTI2026090"]), "CIJDTI2026091");
  assert.equal(nextTaxInvoiceNumber(2027, ["CIJDTI2026090"]), "CIJDTI2027001");
});

test("editor: a fresh line switched to Printing follows Recommended; a typed price stays manual", async () => {
  const { blankDraft, withService, withUnitCost, withQuantity, withFinalTotal, draftFinal } = await import(
    "../../src/components/billing-v3/item-draft.ts"
  );
  let fresh = withService(blankDraft("DESIGN"), "PRINTING");
  assert.equal(fresh.finalMode, "AUTO");
  fresh = withUnitCost(withQuantity(fresh, "500"), "0.24");
  assert.equal(draftFinal(fresh), 156);

  const typed = withService(withFinalTotal(blankDraft("DESIGN"), "150"), "PRINTING");
  assert.notEqual(typed.finalMode, "AUTO");
  assert.equal(draftFinal(typed), 150);
});
