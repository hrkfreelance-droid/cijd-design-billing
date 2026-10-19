import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_INVOICE_ITEMS, additionalInvoiceRows } from "../../src/lib/billing-v5/invoice-limits.ts";

test("invoice line additions stop at the same limit as the API", () => {
  assert.equal(MAX_INVOICE_ITEMS, 40);
  assert.equal(additionalInvoiceRows(0, 5), 5);
  assert.equal(additionalInvoiceRows(10, 5), 5);
  assert.equal(additionalInvoiceRows(38, 5), 2);
  assert.equal(additionalInvoiceRows(40, 5), 0);
  assert.equal(additionalInvoiceRows(42, 5), 0);
  assert.equal(additionalInvoiceRows(10, -2), 0);
});
