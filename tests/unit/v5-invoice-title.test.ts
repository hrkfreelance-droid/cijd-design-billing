import assert from "node:assert/strict";
import { test } from "node:test";
import { invoiceDisplayTitle } from "../../src/lib/billing-v5/invoice-display-title.ts";

test("new drafts, deposits and final invoices print the standard bilingual Tax Invoice heading", () => {
  for (const invoiceKind of ["FULL", "DEPOSIT_FIXED", "DEPOSIT_PERCENT", "FINAL"] as const) {
    const draft = invoiceDisplayTitle({ invoiceKind, draft: true });
    const issued = invoiceDisplayTitle({ invoiceKind, printedTitle: "TAX_INVOICE" });
    assert.deepEqual(draft, { en: "TAX INVOICE", km: "វិក្កយបត្រអាករ", standard: true });
    assert.deepEqual(issued, draft);
  }
});

test("historical Deposit and Final titles remain unchanged on reprint", () => {
  assert.deepEqual(invoiceDisplayTitle({ invoiceKind: "DEPOSIT_FIXED" }), {
    en: "DEPOSIT TAX INVOICE", km: "វិក្កយបត្រអាករ សម្រាប់ប្រាក់បង់ជាមុន", standard: false,
  });
  assert.deepEqual(invoiceDisplayTitle({ invoiceKind: "DEPOSIT_PERCENT" }), invoiceDisplayTitle({ invoiceKind: "DEPOSIT_FIXED" }));
  assert.deepEqual(invoiceDisplayTitle({ invoiceKind: "FINAL" }), {
    en: "FINAL TAX INVOICE", km: "វិក្កយបត្រអាករចុងក្រោយ", standard: false,
  });
  assert.deepEqual(invoiceDisplayTitle({}), { en: "TAX INVOICE", km: "វិក្កយបត្រអាករ", standard: true });
});
