import assert from "node:assert/strict";
import { test } from "node:test";
import { invoiceActionAvailability } from "../../src/lib/billing-v5/invoice-action-availability";
import { example457, invoiceWorkspaceFixture } from "../fixtures/v5-invoice-workspace";
import type { TaxInvoiceRecord } from "../../src/lib/types";

function contract() {
  const snapshot = invoiceWorkspaceFixture();
  const deposit: TaxInvoiceRecord = { ...structuredClone(example457), invoiceKind: "DEPOSIT_FIXED", contractId: "example-contract",
    contractSnapshot: { id: "example-contract", clientId: "c1", lines: [{ billingItemId: "example-line", description: "Example work", quantity: 1, unitPrice: 100, amount: 100 }],
      subtotalUsd: 100, vatApplicable: false, vatPercent: 0, vatUsd: 0, totalUsd: 100 } };
  snapshot.taxInvoices = [deposit];
  return { snapshot, deposit };
}

test("invoice actions: FULL invoices keep edit/cancel; only a deposit with a contract can issue final", () => {
  const snapshot = invoiceWorkspaceFixture();
  assert.deepEqual(invoiceActionAvailability(snapshot, example457), { depositLocked: false, laterDeposit: false, canIssueFinal: false });
  const { snapshot: s, deposit } = contract();
  assert.equal(invoiceActionAvailability(s, deposit).canIssueFinal, true);
  for (const invoice of [{ ...deposit, contractId: undefined }, { ...deposit, contractSnapshot: undefined }, { ...deposit, status: "CANCELLED" as const }]) {
    assert.equal(invoiceActionAvailability(s, invoice).canIssueFinal, false);
  }
});

test("invoice actions: an active final locks deposits; a cancelled final does not", () => {
  const { snapshot, deposit } = contract();
  const final: TaxInvoiceRecord = { ...deposit, id: "example-final", invoiceKind: "FINAL" };
  snapshot.taxInvoices!.push(final);
  assert.equal(invoiceActionAvailability(snapshot, deposit).depositLocked, true);
  assert.equal(invoiceActionAvailability(snapshot, deposit).canIssueFinal, false);
  final.status = "CANCELLED";
  assert.equal(invoiceActionAvailability(snapshot, deposit).depositLocked, false);
  assert.equal(invoiceActionAvailability(snapshot, deposit).canIssueFinal, true);
});

test("invoice actions: earlier deposits keep their sequence lock, including an issue-time tie", () => {
  const { snapshot, deposit } = contract();
  const next = { ...deposit, id: "example-next-deposit", invoiceNumber: "CIJDTI2026458" };
  snapshot.taxInvoices!.push(next);
  assert.equal(invoiceActionAvailability(snapshot, deposit).laterDeposit, true);
  assert.equal(invoiceActionAvailability(snapshot, next).laterDeposit, false);
  next.invoiceNumber = "CIJDTI2026456";
  next.issuedAt = "2026-11-21T00:00:00Z";
  assert.equal(invoiceActionAvailability(snapshot, deposit).laterDeposit, true);
  next.status = "CANCELLED";
  assert.equal(invoiceActionAvailability(snapshot, deposit).laterDeposit, false);
});

test("invoice actions: final is unavailable after full allocation; voided allocations release the remainder", () => {
  const { snapshot, deposit } = contract();
  snapshot.billingAllocations = [{ id: "example-allocation", invoiceId: deposit.id, billingItemId: "example-line", amount: 100, createdAt: "2026-11-20T00:00:00Z", createdBy: "Example" }];
  assert.equal(invoiceActionAvailability(snapshot, deposit).canIssueFinal, false);
  snapshot.billingAllocations[0].voidedAt = "2026-11-21T00:00:00Z";
  assert.equal(invoiceActionAvailability(snapshot, deposit).canIssueFinal, true);
});

test("invoice actions: another contract's final and allocations do not lock this deposit", () => {
  const { snapshot, deposit } = contract();
  snapshot.taxInvoices!.push({ ...deposit, id: "example-unrelated-final", contractId: "other-contract", invoiceKind: "FINAL" });
  snapshot.billingAllocations = [{ id: "example-unrelated-allocation", invoiceId: "example-unrelated-final", billingItemId: "example-line", amount: 100, createdAt: "2026-11-20T00:00:00Z", createdBy: "Example" }];
  assert.deepEqual(invoiceActionAvailability(snapshot, deposit), { depositLocked: false, laterDeposit: false, canIssueFinal: true });
});
