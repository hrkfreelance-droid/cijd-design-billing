import assert from "node:assert/strict";
import { test } from "node:test";

import { A4_HEIGHT_PX, invoicePageScale } from "../../src/components/billing-v5/print-fit";

test("ordinary one-page invoice is not scaled", () => {
  assert.equal(invoicePageScale(A4_HEIGHT_PX), 1);
  assert.equal(invoicePageScale(A4_HEIGHT_PX - 30), 1);
});

test("overflowing invoice fits in one A4 with uniform scaling", () => {
  for (const height of [A4_HEIGHT_PX + 1, 1400, 2300, 6000]) {
    const factor = invoicePageScale(height);
    assert.ok(factor > 0 && factor < 1);
    assert.ok(height * factor <= A4_HEIGHT_PX - 11.9);
  }
});

test("transient invalid measurements do not hide invoice", () => {
  assert.equal(invoicePageScale(NaN), 1);
  assert.equal(invoicePageScale(0), 1);
});
