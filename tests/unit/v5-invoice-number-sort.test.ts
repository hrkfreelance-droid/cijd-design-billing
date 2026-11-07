import assert from "node:assert/strict";
import { test } from "node:test";
import { compareInvoiceNumbersDesc } from "../../src/lib/billing-v5/invoice-number-sort.ts";

test("invoice numbers order by their numeric sequence across customers, not issue date or prefix", () => {
  const invoices = ["CIJDTI2026070", "CIJDTI2026041", "CIJD2026124", "CIJDTI2026077", "CIJDTI2026100"];
  assert.deepEqual(invoices.sort(compareInvoiceNumbersDesc), [
    "CIJD2026124", "CIJDTI2026100", "CIJDTI2026077", "CIJDTI2026070", "CIJDTI2026041",
  ]);
});

test("number compare handles leading zeros, distinct years, missing numbers and huge values", () => {
  const invoices = ["old", "CIJDTI2026009", "CIJDTI2027010", "CIJDTI2026999", "CIJDTI2026100", "CIJD9999999999999999999999"];
  assert.deepEqual(invoices.sort(compareInvoiceNumbersDesc), [
    "CIJD9999999999999999999999", "CIJDTI2027010", "CIJDTI2026999",
    "CIJDTI2026100", "CIJDTI2026009", "old",
  ]);
});
