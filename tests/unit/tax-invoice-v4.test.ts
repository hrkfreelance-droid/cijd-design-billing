import test from "node:test";
import assert from "node:assert/strict";
import { allocateInvoiceNumber, calculateTaxInvoice, assertIssueable } from "@/lib/tax-invoice-v4";

const line = (description: string, quantity: string, unitPrice: string, sourceType: "MANUAL" | "BILLING_ITEM" = "MANUAL") => ({ id: description, description, quantity, unitPrice, sourceType, sortOrder: 0 });

test("V4 tax invoice calculates VAT and frozen KHR totals", () => {
  assert.deepEqual(calculateTaxInvoice([line("Design", "2", "75")], 4025), { subtotal: "150.00", vatAmount: "15.00", usdTotal: "165.00", khrTotal: "664125" });
});
test("V4 tax invoice supports mixed manual and billing lines", () => {
  assert.equal(calculateTaxInvoice([line("Billing", "1", "10", "BILLING_ITEM"), line("Manual", "3", "2")]).usdTotal, "17.60");
});
test("V4 numbering allocates the next year sequence", () => {
  assert.equal(allocateInvoiceNumber(2026, ["CIJDTI2026001", "CIJDTI2026045", "CIJDTI2026079"]), "CIJDTI2026080");
});
test("V4 issue validation requires customer, date, and line", () => {
  assert.doesNotThrow(() => assertIssueable({ customerName: "ACME", invoiceDate: "2026-09-28", lines: [line("x", "1", "1")] }));
  assert.throws(() => assertIssueable({ customerName: "", invoiceDate: "2026-09-28", lines: [line("x", "1", "1")] }));
});
