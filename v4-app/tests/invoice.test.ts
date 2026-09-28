import assert from "node:assert/strict";
import test from "node:test";

import { customerSnapshot, formatInvoiceNumber, invoiceTotals, VAT_PERCENT } from "../src/domain/invoice.ts";

test("numbering continues after the verified 2026 legacy maximum", () => {
  assert.equal(formatInvoiceNumber(2026, 81), "CIJDTI2026081");
  assert.equal(formatInvoiceNumber(2026, 999), "CIJDTI2026999");
});

test("invoice totals use Final Unit times Quantity and VAT 10%", () => {
  const totals = invoiceTotals([
    { quantity: 2, finalUnitUsd: 12.5 },
    { quantity: 3, finalUnitUsd: 10 },
  ], 4026);
  assert.equal(VAT_PERCENT, 10);
  assert.deepEqual(totals, {
    subtotalUsd: 55,
    vatPercent: 10,
    vatUsd: 5.5,
    totalUsd: 60.5,
    totalKhr: 243_573,
  });
});

test("customer snapshot is a detached value", () => {
  const source = { companyNameEn: "A", companyNameKm: "ក", contactName: "C", addressEn: "E", addressKm: "ខ", telephone: "1", vatin: "K1" };
  const snapshot = customerSnapshot(source);
  source.companyNameEn = "Changed";
  assert.equal(snapshot.companyNameEn, "A");
});
