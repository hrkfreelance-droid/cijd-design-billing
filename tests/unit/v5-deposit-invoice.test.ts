import assert from "node:assert/strict";
import { test } from "node:test";

import { billingState, invoiceCollection } from "../../src/lib/billing-v5/ontology.ts";
import { buildV5Seed } from "../../src/lib/billing-v5/repository.ts";
import { d1Persistence } from "../../src/lib/billing-v5/d1-persistence.ts";
import { RuleError } from "../../src/lib/data/repository.ts";
import { Store } from "../../src/lib/data/store.ts";
import type { Database } from "../../src/lib/types.ts";
import { sqliteD1 } from "./d1-sqlite.ts";

const CUSTOMER = {
  companyNameEn: "TEST Deposit Customer Co., Ltd.",
  companyNameKm: "ក្រុមហ៊ុន តេស្ត",
  addressEn: "Phnom Penh",
  addressKm: "ភ្នំពេញ",
  telephone: "012 345 678",
  vatin: "K001-123456789",
};

async function rejectsWith(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => error instanceof RuleError && error.code === code);
}

async function env() {
  const d1 = sqliteD1();
  const open = () => new Store(d1Persistence(d1, buildV5Seed));
  const edit = async (change: (db: Database) => void) => {
    const persistence = d1Persistence(d1, buildV5Seed);
    const db = await persistence.read();
    if (!db) throw new Error("The local D1 database did not return a state.");
    change(db);
    await persistence.write(db);
  };
  await edit((db) => db.exchangeRates.push({
    id: "test-rate",
    currencyPair: "USD/KHR",
    rate: 4100,
    source: "NBC",
    effectiveDate: "2026-09-29",
    fetchedAt: "2026-09-29T10:00:00Z",
  }));
  const client = await open().createClient({ name: "TEST Deposit Customer" });
  const billing = async (name: string, amount: number, clientId = client.id) => {
    const project = await open().createProject({ clientId, name });
    const line = await open().createBillingItem({ projectId: project.id, description: name, type: "DESIGN", serviceType: "DESIGN", quantity: 1, amount, finalMode: "MANUAL" });
    await open().setProjectBillingReadiness(project.id, "READY");
    await open().setProjectBillingReadiness(project.id, "ACCOUNTING");
    return { project, line };
  };
  const issue = (items: { billingItemId?: string; description?: string; amount?: number; productId?: string }[], extra: Record<string, unknown> = {}) =>
    open().issueInvoice({
      customerId: client.id,
      invoiceDate: "2026-09-29",
      customer: CUSTOMER,
      items: items.map((item) => ({ description: item.description ?? "Work", quantity: 1, unitPrice: item.amount ?? 0, ...item })),
      actor: "TEST",
      ...extra,
    });
  const snap = () => open().getSnapshot();
  return { d1, open, edit, client, billing, issue, snap };
}

test("fixed pre-VAT deposit $100 of $200 invoices half the contract and final closes base and VAT once", async () => {
  const t = await env();
  const { line } = await t.billing("TEST $200 line", 200);
  const deposit = await t.issue([{ billingItemId: line.id }], { invoiceKind: "DEPOSIT_FIXED", depositValue: 100 });
  assert.deepEqual([deposit.invoiceKind, deposit.subtotalUsd, deposit.vatUsd, deposit.totalUsd, deposit.depositUsd], ["DEPOSIT_FIXED", 100, 10, 110, 0]);
  assert.deepEqual([deposit.contractSnapshot?.subtotalUsd, deposit.contractSnapshot?.vatUsd, deposit.contractSnapshot?.totalUsd], [200, 20, 220]);
  assert.deepEqual([deposit.lines[0].quantity, deposit.lines[0].unit, deposit.lines[0].unitPrice, deposit.lines[0].amount], [1, "advance", 100, 100]);

  const depositPayment = await t.open().addInvoicePayment({ invoiceId: deposit.id, amount: 100, paidOn: "2026-09-29", actor: "TEST" });
  assert.deepEqual([depositPayment.kind, depositPayment.invoiceId], ["PAYMENT", deposit.id]);
  const depositState = invoiceCollection(await t.snap(), deposit);
  assert.deepEqual([depositState.paidUsd, depositState.outstandingUsd], [100, 10]);
  const remaining = billingState(await t.snap(), (await t.snap()).billingItems.find((item) => item.id === line.id)!);
  assert.equal(remaining.remainingUsd, 100);

  const final = await t.issue([{ billingItemId: line.id, amount: 999999 }], { invoiceKind: "FINAL", contractId: deposit.contractId });
  assert.deepEqual([final.invoiceKind, final.subtotalUsd, final.vatUsd, final.totalUsd, final.depositUsd], ["FINAL", 100, 10, 110, 0]);
  assert.deepEqual(final.depositReferences?.map((reference) => [reference.invoiceNumber, reference.subtotalUsd, reference.vatUsd, reference.totalUsd]), [[deposit.invoiceNumber, 100, 10, 110]]);
  assert.equal(final.lines[0].amount, 100); // submitted $999,999 was ignored
  assert.equal(invoiceCollection(await t.snap(), final).outstandingUsd, 110); // deposit payment belongs only to its own invoice
  assert.deepEqual(
    [deposit.subtotalUsd + final.subtotalUsd, deposit.vatUsd + final.vatUsd, deposit.totalUsd + final.totalUsd],
    [deposit.contractSnapshot!.subtotalUsd, deposit.contractSnapshot!.vatUsd, deposit.contractSnapshot!.totalUsd],
  );
});

test("50 percent deposit and cent rounding distribute line amounts exactly and leave VAT remainder to FINAL", async () => {
  const t = await env();
  const first = await t.billing("TEST odd five cents", 0.05);
  const second = await t.billing("TEST uneven five cents", 0.05);
  const deposit = await t.issue(
    [{ billingItemId: first.line.id }, { billingItemId: second.line.id }],
    { invoiceKind: "DEPOSIT_PERCENT", depositValue: 50 },
  );
  assert.equal(deposit.subtotalUsd, 0.05);
  assert.equal(deposit.lines.reduce((sum, line) => sum + Math.round(line.amount * 100), 0), 5);
  assert.deepEqual(deposit.lines.map((line) => line.amount).sort(), [0.02, 0.03]);
  const final = await t.issue(
    [{ billingItemId: first.line.id }, { billingItemId: second.line.id }],
    { invoiceKind: "FINAL", contractId: deposit.contractId },
  );
  assert.deepEqual([deposit.contractSnapshot?.subtotalUsd, deposit.contractSnapshot?.vatUsd, deposit.contractSnapshot?.totalUsd], [0.1, 0.01, 0.11]);
  assert.deepEqual([deposit.subtotalUsd + final.subtotalUsd, deposit.vatUsd + final.vatUsd], [0.1, 0.01]);
  assert.equal(deposit.totalUsd + final.totalUsd, 0.11);
});

test("a line rounded to zero cents stays reserved by its active deposit contract", async () => {
  const t = await env();
  const large = await t.billing("TEST large allocation weight", 200);
  const tiny = await t.billing("TEST zero-cent allocation", 0.01);
  const deposit = await t.issue(
    [{ billingItemId: large.line.id }, { billingItemId: tiny.line.id }],
    { invoiceKind: "DEPOSIT_FIXED", depositValue: 0.01 },
  );
  assert.equal(deposit.subtotalUsd, 0.01);
  assert.deepEqual(deposit.lines.map((line) => line.billingItemId), [large.line.id]);
  await rejectsWith(t.issue([{ billingItemId: tiny.line.id, amount: 0.01 }]), "INVOICE_KIND_CONFLICT");
  await rejectsWith(t.issue([{ billingItemId: tiny.line.id }], { invoiceKind: "DEPOSIT_FIXED", depositValue: 0.005 }), "INVOICE_KIND_CONFLICT");
});

test("multiple deposits reference every earlier number and cumulative VAT rounds once across the contract", async () => {
  const t = await env();
  const { line } = await t.billing("TEST multiple deposits", 200);
  const first = await t.issue([{ billingItemId: line.id }], { invoiceKind: "DEPOSIT_FIXED", depositValue: 50 });
  const second = await t.issue([{ billingItemId: line.id }], { invoiceKind: "DEPOSIT_PERCENT", depositValue: 50, contractId: first.contractId });
  assert.deepEqual([first.subtotalUsd, first.vatUsd, second.subtotalUsd, second.vatUsd], [50, 5, 75, 7.5]);
  await rejectsWith(t.open().editInvoice(first.id, {
    customerId: t.client.id, invoiceDate: first.invoiceDate, customer: CUSTOMER,
    items: [{ billingItemId: line.id, description: "Work", quantity: 1, unitPrice: 50 }],
    invoiceKind: "DEPOSIT_FIXED", depositValue: 60, contractId: first.contractId, actor: "TEST",
  }), "DEPOSIT_SEQUENCE_LOCKED");
  await rejectsWith(t.open().cancelTaxInvoice(first.id, "older deposit", "TEST"), "DEPOSIT_SEQUENCE_LOCKED");
  const final = await t.issue([{ billingItemId: line.id }], { invoiceKind: "FINAL", contractId: first.contractId });
  assert.deepEqual([final.subtotalUsd, final.vatUsd, final.totalUsd], [75, 7.5, 82.5]);
  assert.deepEqual(final.depositReferences?.map((reference) => reference.invoiceNumber), [first.invoiceNumber, second.invoiceNumber]);
  assert.equal(new Set([first.invoiceNumber, second.invoiceNumber, final.invoiceNumber]).size, 3);
  assert.deepEqual(
    [first.subtotalUsd + second.subtotalUsd + final.subtotalUsd, first.vatUsd + second.vatUsd + final.vatUsd],
    [200, first.contractSnapshot!.vatUsd],
  );
});

test("FULL and deposit contract allocations cannot be mixed; deposit restrictions are enforced", async () => {
  const fullFirst = await env();
  const a = await fullFirst.billing("TEST full first", 200);
  await fullFirst.issue([{ billingItemId: a.line.id, amount: 100 }]);
  await rejectsWith(fullFirst.issue([{ billingItemId: a.line.id }], { invoiceKind: "DEPOSIT_FIXED", depositValue: 50 }), "INVOICE_KIND_CONFLICT");

  const depositFirst = await env();
  const b = await depositFirst.billing("TEST deposit first", 200);
  await depositFirst.issue([{ billingItemId: b.line.id }], { invoiceKind: "DEPOSIT_FIXED", depositValue: 50 });
  await rejectsWith(depositFirst.issue([{ billingItemId: b.line.id, amount: 150 }]), "INVOICE_KIND_CONFLICT");
  await rejectsWith(depositFirst.issue([{ description: "free line", amount: 20 }], { invoiceKind: "DEPOSIT_FIXED", depositValue: 10 }), "DEPOSIT_REQUIRES_BILLING_LINES");
  await rejectsWith(depositFirst.issue([{ billingItemId: b.line.id }], { invoiceKind: "DEPOSIT_FIXED", depositValue: 10, discount: { type: "FIXED", value: 1 } }), "DEPOSIT_RESTRICTION");
  await rejectsWith(depositFirst.issue([{ billingItemId: b.line.id }], { invoiceKind: "DEPOSIT_FIXED", depositValue: 10, depositUsd: 1 }), "DEPOSIT_RESTRICTION");
  await rejectsWith(depositFirst.issue([{ billingItemId: b.line.id }], { invoiceKind: "DEPOSIT_FIXED", depositValue: 10, depositUsd: 0.004 }), "DEPOSIT_RESTRICTION");
  const { line: fresh } = await depositFirst.billing("TEST invalid percent", 200);
  await rejectsWith(depositFirst.issue([{ billingItemId: fresh.id }], { invoiceKind: "DEPOSIT_PERCENT", depositValue: 100 }), "INVALID_DEPOSIT_VALUE");
  await rejectsWith(depositFirst.issue([{ billingItemId: fresh.id }], { invoiceKind: "DEPOSIT_FIXED", depositValue: 10.001 }), "INVALID_DEPOSIT_VALUE");
});

test("deposit invoices can be edited before FINAL; FINAL references are customer-bound and lock deposit edit/cancel", async () => {
  const t = await env();
  const { line } = await t.billing("TEST editable deposit", 200);
  const deposit = await t.issue([{ billingItemId: line.id }], { invoiceKind: "DEPOSIT_FIXED", depositValue: 50 });
  const edited = await t.open().editInvoice(deposit.id, {
    customerId: t.client.id,
    invoiceDate: deposit.invoiceDate,
    customer: CUSTOMER,
    items: [{ billingItemId: line.id, description: "ignored input", quantity: 1, unitPrice: 150, amount: 150 }],
    invoiceKind: "DEPOSIT_FIXED",
    depositValue: 80,
    contractId: deposit.contractId,
    actor: "TEST",
  });
  assert.deepEqual([edited.subtotalUsd, edited.vatUsd, edited.revision], [80, 8, 2]);

  const other = await t.open().createClient({ name: "TEST Other Deposit Customer" });
  await rejectsWith(t.open().issueInvoice({
    customerId: other.id,
    invoiceDate: deposit.invoiceDate,
    customer: CUSTOMER,
    items: [{ billingItemId: line.id, description: "Work", quantity: 1, unitPrice: 120 }],
    invoiceKind: "FINAL",
    contractId: deposit.contractId,
    actor: "TEST",
  }), "DIFFERENT_CUSTOMER");

  const final = await t.issue([{ billingItemId: line.id }], { invoiceKind: "FINAL", contractId: deposit.contractId });
  assert.equal(final.depositReferences?.[0].invoiceNumber, deposit.invoiceNumber);
  await rejectsWith(t.open().editInvoice(deposit.id, {
    customerId: t.client.id,
    invoiceDate: deposit.invoiceDate,
    customer: CUSTOMER,
    items: [{ billingItemId: line.id, description: "Work", quantity: 1, unitPrice: 200 }],
    invoiceKind: "DEPOSIT_FIXED",
    depositValue: 90,
    contractId: deposit.contractId,
    actor: "TEST",
  }), "DEPOSIT_LOCKED");
  await rejectsWith(t.open().cancelTaxInvoice(deposit.id, "wrong invoice", "TEST"), "DEPOSIT_LOCKED");
  await rejectsWith(t.open().editInvoice(final.id, {
    customerId: t.client.id,
    invoiceDate: final.invoiceDate,
    customer: CUSTOMER,
    items: [{ billingItemId: line.id, description: "Work", quantity: 1, unitPrice: 120 }],
    invoiceKind: "FULL",
    actor: "TEST",
  }), "INVOICE_KIND_IMMUTABLE");
});

test("duplicate issue request returns the same invoice; concurrent stale writers cannot commit twice", async () => {
  const t = await env();
  const { line } = await t.billing("TEST idempotency", 200);
  const input = {
    customerId: t.client.id,
    invoiceDate: "2026-09-29",
    customer: CUSTOMER,
    items: [{ billingItemId: line.id, description: "Work", quantity: 1, unitPrice: 200 }],
    invoiceKind: "DEPOSIT_FIXED",
    depositValue: 50,
    requestKey: "deposit-issue-retry-1",
    actor: "TEST",
  };
  const one = new Store(d1Persistence(t.d1, buildV5Seed));
  const two = new Store(d1Persistence(t.d1, buildV5Seed));
  const results = await Promise.allSettled([one.issueInvoice(input), two.issueInvoice(input)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const failed = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
  assert.ok(failed.reason instanceof RuleError && failed.reason.code === "CONFLICT");
  const issued = (await t.snap()).taxInvoices!.filter((invoice) => invoice.status === "ISSUED");
  assert.equal(issued.length, 1);
  const retry = await t.open().issueInvoice(input);
  assert.equal(retry.id, issued[0].id);
  await rejectsWith(t.open().issueInvoice({ ...input, depositValue: 51 }), "IDEMPOTENCY_CONFLICT");
});

test("legacy FULL invoice snapshots and received-deposit balance behavior remain unchanged", async () => {
  const t = await env();
  const { line } = await t.billing("TEST legacy full", 200);
  const full = await t.issue([{ billingItemId: line.id, amount: 200 }], { depositUsd: 25 });
  assert.equal(full.invoiceKind, "FULL");
  assert.deepEqual([full.subtotalUsd, full.vatUsd, full.totalUsd, full.depositUsd], [200, 20, 220, 25]);
  assert.equal(invoiceCollection(await t.snap(), full).outstandingUsd, 195);
  await t.edit((db) => { delete db.taxInvoices!.find((invoice) => invoice.id === full.id)!.invoiceKind; });
  const legacy = (await t.snap()).taxInvoices!.find((invoice) => invoice.id === full.id)!;
  assert.equal(legacy.invoiceKind, undefined);
  assert.equal(invoiceCollection(await t.snap(), legacy).outstandingUsd, 195);
});

test("a cancelled deposit contract cannot be reused as an unreferenced FINAL", async () => {
  const t = await env();
  const { line } = await t.billing("TEST cancelled contract", 200);
  const deposit = await t.issue([{ billingItemId: line.id }], { invoiceKind: "DEPOSIT_FIXED", depositValue: 50 });
  await t.open().cancelTaxInvoice(deposit.id, "TEST cancelled before payment", "TEST");
  await rejectsWith(t.issue([{ billingItemId: line.id }], { invoiceKind: "FINAL", contractId: deposit.contractId }), "CONTRACT_NOT_OPEN");
});
