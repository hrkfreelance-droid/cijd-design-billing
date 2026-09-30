import assert from "node:assert/strict";
import { test } from "node:test";

import { d1Persistence } from "../../src/lib/billing-v5/d1-persistence.ts";
import { invoiceTotals } from "../../src/lib/billing-v5/calculation.ts";
import { billingState, eligibleBilling, invoiceCollection } from "../../src/lib/billing-v5/ontology.ts";
import { buildV5Seed } from "../../src/lib/billing-v5/repository.ts";
import { RuleError } from "../../src/lib/data/repository.ts";
import { Store } from "../../src/lib/data/store.ts";
import type { Database, TaxInvoiceRecord } from "../../src/lib/types.ts";
import { sqliteD1 } from "./d1-sqlite.ts";

const CUSTOMER = { companyNameEn: "TEST Customer Co., Ltd.", companyNameKm: "ក្រុមហ៊ុន តេស្ត", addressEn: "Phnom Penh", addressKm: "ភ្នំពេញ", telephone: "012 345 678", vatin: "K001-123456789" };

async function rejectsWith(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => error instanceof RuleError && error.code === code);
}

async function env() {
  const d1 = sqliteD1();
  const open = () => new Store(d1Persistence(d1, buildV5Seed));
  const edit = async (change: (db: Database) => void) => {
    const persistence = d1Persistence(d1, buildV5Seed);
    const db = (await persistence.read())!;
    change(db);
    await persistence.write(db);
  };
  const rate = (effectiveDate: string, value: number) =>
    edit((db) => db.exchangeRates.push({ id: `nbc-${effectiveDate}`, currencyPair: "USD/KHR", rate: value, source: "NBC", effectiveDate, fetchedAt: `${effectiveDate}T10:00:00Z` }));
  await rate("2026-09-29", 4105);
  await rate("2026-12-30", 4110);
  await rate("2027-01-04", 4120);
  const client = await open().createClient({ name: "Unit Customer" });
  /** A ready project with one Design line at `amount`. */
  const billing = async (name: string, amount: number, clientId = client.id) => {
    const project = await open().createProject({ clientId, name });
    const line = await open().createBillingItem({ projectId: project.id, description: name, type: "DESIGN", serviceType: "DESIGN", quantity: 1, amount, finalMode: "MANUAL" });
    await open().setProjectBillingReadiness(project.id, "READY");
    return { project, line };
  };
  const issue = (items: { billingItemId?: string; description?: string; quantity?: number; unitPrice?: number; amount?: number; productId?: string }[], extra: Record<string, unknown> = {}) =>
    open().issueInvoice({
      customerId: client.id,
      invoiceDate: "2026-09-29",
      customer: CUSTOMER,
      items: items.map((item) => ({ description: item.description ?? "Work", quantity: item.quantity ?? 1, unitPrice: item.unitPrice ?? item.amount ?? 0, ...item })),
      actor: "TEST",
      ...extra,
    });
  const snap = () => open().getSnapshot();
  return { d1, open, edit, rate, client, billing, issue, snap };
}

test("Customer Master and Product Master: create, code, edit, search fields", async () => {
  const { open, client } = await env();
  const customer = await open().saveCustomer({ id: client.id, ...CUSTOMER, contactPerson: "Ms. Test", email: "test@example.com", actor: "TEST" });
  assert.equal(customer.customerCode, "C0001");
  const created = await open().saveCustomer({ name: "TEST Second", companyNameEn: "TEST Second Ltd.", actor: "TEST" });
  assert.equal(created.customerCode, "C0002");
  assert.ok((await open().getSnapshot()).clients.some((entry) => entry.id === created.id)); // usable on Billing too
  await rejectsWith(open().saveCustomer({ id: created.id, customerCode: "C0001", actor: "TEST" }), "DUPLICATE_CODE");

  const product = await open().saveProduct({ description: "Logo design", defaultUnitPrice: 300, unit: "set", actor: "TEST" });
  assert.equal(product.productCode, "P0001");
  await rejectsWith(open().saveProduct({ description: "logo design", actor: "TEST" }), "DUPLICATE_PRODUCT");
  const edited = await open().saveProduct({ id: product.id, defaultUnitPrice: 320, actor: "TEST" });
  assert.equal(edited.defaultUnitPrice, 320);
  assert.equal(edited.description, "Logo design");
});

test("several billings of one customer on one invoice; another customer's billing is refused", async () => {
  const t = await env();
  const a = await t.billing("TEST A", 100);
  const b = await t.billing("TEST B", 250);
  const invoice = await t.issue([
    { billingItemId: a.line.id, amount: 100, description: "A" },
    { billingItemId: b.line.id, amount: 250, description: "B" },
  ]);
  assert.deepEqual(invoice.projectIds, [a.project.id, b.project.id]);
  assert.equal(invoice.subtotalUsd, 350);
  const s = await t.snap();
  assert.equal(billingState(s, s.billingItems.find((i) => i.id === a.line.id)!).state, "FULLY_INVOICED");

  const other = await t.open().createClient({ name: "TEST Other" });
  const c = await t.billing("TEST C", 50, other.id);
  await rejectsWith(t.issue([{ billingItemId: c.line.id, amount: 50 }]), "DIFFERENT_CUSTOMER");
});

test("partial billing: $1,000 → $300 → $300 → $400 → fully invoiced; over-allocation refused", async () => {
  const t = await env();
  const { line } = await t.billing("TEST Website", 1000);
  const left = async () => {
    const s = await t.snap();
    return billingState(s, s.billingItems.find((i) => i.id === line.id)!);
  };
  const first = await t.issue([{ billingItemId: line.id, amount: 300, description: "Website — deposit" }]);
  assert.deepEqual([(await left()).invoicedUsd, (await left()).remainingUsd, (await left()).state], [300, 700, "PARTIALLY_INVOICED"]);
  await t.issue([{ billingItemId: line.id, amount: 300 }]);
  assert.equal((await left()).remainingUsd, 400);
  await rejectsWith(t.issue([{ billingItemId: line.id, amount: 400.01 }]), "OVER_ALLOCATION");
  // Two lines of the same billing on one invoice count together.
  await rejectsWith(t.issue([{ billingItemId: line.id, amount: 300 }, { billingItemId: line.id, amount: 101 }]), "OVER_ALLOCATION");
  await t.issue([{ billingItemId: line.id, amount: 400 }]);
  const done = await left();
  assert.deepEqual([done.invoicedUsd, done.remainingUsd, done.state, done.invoiceIds.length], [1000, 0, "FULLY_INVOICED", 3]);
  assert.equal(done.invoiceIds[0], first.id);
  assert.equal(eligibleBilling(await t.snap()).length, 0);
  await rejectsWith(t.issue([{ billingItemId: line.id, amount: 1 }]), "OVER_ALLOCATION");

  // Cancelling one invoice gives its $300 back.
  await t.open().cancelTaxInvoice(first.id, "TEST");
  assert.equal((await left()).remainingUsd, 300);
});

test("double billing under a race: the second writer cannot commit, and its retry is refused", async () => {
  const t = await env();
  const { line } = await t.billing("TEST Race", 500);
  const make = (store: Store) =>
    store.issueInvoice({ customerId: t.client.id, invoiceDate: "2026-09-29", customer: CUSTOMER, items: [{ billingItemId: line.id, description: "Race", quantity: 1, unitPrice: 500, amount: 500 }], actor: "TEST" });
  // Two stores that have both read the same version.
  const one = new Store(d1Persistence(t.d1, buildV5Seed));
  const two = new Store(d1Persistence(t.d1, buildV5Seed));
  const results = await Promise.allSettled([make(one), make(two)]);
  const ok = results.filter((result) => result.status === "fulfilled");
  const failed = results.filter((result) => result.status === "rejected") as PromiseRejectedResult[];
  assert.equal(ok.length, 1);
  assert.equal(failed.length, 1);
  assert.ok(failed[0].reason instanceof RuleError && ["CONFLICT", "OVER_ALLOCATION"].includes(failed[0].reason.code), String(failed[0].reason?.stack ?? failed[0].reason));
  await rejectsWith(make(t.open()), "OVER_ALLOCATION");
  assert.equal((await t.snap()).taxInvoices!.filter((invoice) => invoice.status === "ISSUED").length, 1);
});

test("discount (fixed / percent) is taken before VAT; deposit gives Balance Due", async () => {
  const t = await env();
  const { line } = await t.billing("TEST Discount", 1000);
  const fixed = await t.issue([{ billingItemId: line.id, amount: 400 }], { discount: { type: "FIXED", value: 40 }, depositUsd: 100 });
  assert.deepEqual(
    [fixed.subtotalUsd, fixed.discountUsd, fixed.taxableUsd, fixed.vatUsd, fixed.totalUsd, fixed.depositUsd],
    [400, 40, 360, 36, 396, 100],
  );
  assert.equal(invoiceTotals({ lines: fixed.lines, discount: fixed.discount, vatApplicable: true, exchangeRate: 4105, deposit: 100 }).balanceDueUsd, 296);
  const pct = await t.issue([{ billingItemId: line.id, amount: 333.33 }], { discount: { type: "PERCENT", value: 12.5 } });
  assert.deepEqual([pct.discountUsd, pct.taxableUsd, pct.vatUsd, pct.totalUsd], [41.67, 291.66, 29.17, 320.83]);
  await rejectsWith(t.issue([{ billingItemId: line.id, amount: 10 }], { discount: { type: "FIXED", value: 11 } }), "INVALID");
  await rejectsWith(t.issue([{ billingItemId: line.id, amount: 10 }], { discount: { type: "PERCENT", value: 101 } }), "INVALID");
  // An invoice without a discount totals exactly as before.
  const plain = await t.issue([{ description: "TEST free line", quantity: 2, unitPrice: 50 }]);
  assert.deepEqual([plain.subtotalUsd, plain.discountUsd, plain.vatUsd, plain.totalUsd], [100, 0, 10, 110]);
});

test("payments: deposit, partial, final → collected; overpayment refused; voids keep history", async () => {
  const t = await env();
  const { line } = await t.billing("TEST Pay", 1000);
  const invoice = await t.issue([{ billingItemId: line.id, amount: 1000 }], { depositUsd: 100 }); // total $1,100
  const state = async () => invoiceCollection(await t.snap(), (await t.snap()).taxInvoices!.find((i) => i.id === invoice.id)!);
  assert.deepEqual([(await state()).paidUsd, (await state()).outstandingUsd, (await state()).status], [100, 1000, "PARTIALLY_PAID"]);
  const partial = await t.open().addInvoicePayment({ invoiceId: invoice.id, amount: 800, paidOn: "2026-10-05", actor: "TEST" });
  assert.equal((await state()).outstandingUsd, 200);
  await rejectsWith(t.open().addInvoicePayment({ invoiceId: invoice.id, amount: 200.01, actor: "TEST" }), "OVERPAYMENT");
  await t.open().voidInvoicePayment(partial.id, "TEST wrong amount");
  assert.equal((await state()).outstandingUsd, 1000);
  assert.equal((await state()).payments.length, 2); // the voided one is kept
  await t.open().addInvoicePayment({ invoiceId: invoice.id, amount: 1000, paidOn: "2026-10-06", actor: "TEST" });
  assert.deepEqual([(await state()).outstandingUsd, (await state()).status], [0, "PAID"]);
  const deposit = (await state()).payments.find((p) => p.kind === "DEPOSIT")!;
  await rejectsWith(t.open().voidInvoicePayment(deposit.id, "x", "TEST"), "USE_EDIT");
  await rejectsWith(t.open().cancelTaxInvoice(invoice.id, "x"), "INVOICE_PAID");
});

test("edit: same date keeps the saved rate; a new date takes that date's rate; number fixed; history kept", async () => {
  const t = await env();
  const { line } = await t.billing("TEST Edit", 1000);
  const invoice = await t.issue([{ billingItemId: line.id, amount: 500, description: "First" }]);
  assert.equal(invoice.exchangeRate, 4105);
  const base = { customerId: t.client.id, customer: CUSTOMER, actor: "TEST" };

  // A newer rate appears; editing without changing the date keeps 4105.
  await t.rate("2026-10-01", 4200);
  const same = await t.open().editInvoice(invoice.id, { ...base, invoiceDate: "2026-09-29", items: [{ billingItemId: line.id, description: "First, corrected", quantity: 1, unitPrice: 600, amount: 600 }], discount: { type: "FIXED", value: 10 }, reason: "TEST price" });
  assert.equal(same.exchangeRate, 4105);
  assert.equal(same.invoiceNumber, invoice.invoiceNumber);
  assert.equal(same.revision, 2);
  assert.equal(same.totalUsd, 649); // (600 − 10) × 1.1

  // A new date takes the official rate for that date.
  const moved = await t.open().editInvoice(invoice.id, { ...base, invoiceDate: "2026-10-02", items: same.lines.map((l) => ({ ...l, billingItemId: l.billingItemId ?? undefined })), discount: same.discount });
  assert.equal(moved.exchangeRate, 4200);
  assert.equal(moved.exchangeRateEffectiveDate, "2026-10-01");
  // No official rate for a date: the rate must be entered by hand.
  await rejectsWith(t.open().editInvoice(invoice.id, { ...base, invoiceDate: "2026-11-30", items: [{ billingItemId: line.id, description: "x", quantity: 1, unitPrice: 600, amount: 600 }] }), "RATE_REQUIRED");
  const manual = await t.open().editInvoice(invoice.id, { ...base, invoiceDate: "2026-11-30", exchangeRate: { rate: 4150, source: "MANUAL" }, items: [{ billingItemId: line.id, description: "x", quantity: 1, unitPrice: 600, amount: 600 }] });
  assert.equal(manual.exchangeRateSource, "MANUAL");

  await rejectsWith(t.open().editInvoice(invoice.id, { ...base, invoiceNumber: "CIJDTI2026999", invoiceDate: "2026-11-30", items: [{ billingItemId: line.id, description: "x", quantity: 1, unitPrice: 600, amount: 600 }] }), "NUMBER_IMMUTABLE");
  await rejectsWith(t.open().editInvoice(invoice.id, { ...base, invoiceDate: "2026-11-30", items: [{ billingItemId: line.id, description: "x", quantity: 1, unitPrice: 1001, amount: 1001 }] }), "OVER_ALLOCATION");

  const s = await t.snap();
  const revisions = s.invoiceRevisions!.filter((r) => r.invoiceId === invoice.id).sort((a, b) => a.revision - b.revision);
  assert.deepEqual(revisions.map((r) => [r.revision, r.action]), [[1, "ISSUE"], [2, "EDIT"], [3, "EDIT"], [4, "EDIT"]]);
  assert.equal(revisions[1].previousSnapshot!.lines[0].description, "First");
  assert.equal(revisions[1].reason, "TEST price");
  // The allocation follows the edit: $600 billed, $400 left.
  assert.equal(billingState(s, s.billingItems.find((i) => i.id === line.id)!).remainingUsd, 400);
  // Revisions are also written to an insert-only D1 table.
  assert.equal((t.d1.raw.prepare("SELECT count(*) AS n FROM v5_invoice_revisions WHERE invoice_id = ?").get(invoice.id) as { n: number }).n, 4);
  assert.throws(() => t.d1.raw.prepare("DELETE FROM v5_invoice_revisions").run(), /immutable/);
  assert.throws(() => t.d1.raw.prepare("UPDATE v5_invoice_revisions SET action = 'X'").run(), /immutable/);
});

test("invoices cannot be deleted: there is no delete operation or route", async () => {
  const store = (await env()).open() as unknown as Record<string, unknown>;
  assert.equal(store.deleteInvoice, undefined);
  assert.equal(store.deleteTaxInvoice, undefined);
  const route = await import("../../src/app/api/v5/tax-invoices/[id]/route.ts").catch(() => null);
  if (route) assert.equal((route as Record<string, unknown>).DELETE, undefined);
});

test("numbers run per year: 2026 continues after the paper series, 2027 restarts at 001; cancelled numbers are not reused", async () => {
  const t = await env();
  const free = (date: string) => t.issue([{ description: "TEST numbering", quantity: 1, unitPrice: 1 }], { invoiceDate: date });
  const a = await free("2026-09-29");
  const b = await free("2026-12-30");
  await t.open().cancelTaxInvoice(b.id, "TEST");
  const c = await free("2026-12-30");
  const d = await free("2027-01-04");
  const e = await free("2027-01-04");
  assert.deepEqual([a, b, c, d, e].map((i) => i.invoiceNumber), ["CIJDTI2026081", "CIJDTI2026082", "CIJDTI2026083", "CIJDTI2027001", "CIJDTI2027002"]);
});

test("TEST customers are numbered in their own series and never touch the real sequence", async () => {
  const t = await env();
  const testClient = await t.open().createClient({ name: "TEST E2E Customer" });
  const testInvoice = (date: string) =>
    t.open().issueInvoice({ customerId: testClient.id, invoiceDate: date, customer: CUSTOMER, items: [{ description: "TEST", quantity: 1, unitPrice: 1 }], actor: "TEST" });
  assert.equal((await testInvoice("2026-09-29")).invoiceNumber, "TEST-CIJDTI2026001");
  assert.equal((await testInvoice("2026-09-29")).invoiceNumber, "TEST-CIJDTI2026002");
  assert.equal((await t.issue([{ description: "Real", quantity: 1, unitPrice: 1 }])).invoiceNumber, "CIJDTI2026081");
  assert.equal((await testInvoice("2027-01-04")).invoiceNumber, "TEST-CIJDTI2027001");
});

test("master edits never reach issued invoices", async () => {
  const t = await env();
  const product = await t.open().saveProduct({ description: "TEST Banner", defaultUnitPrice: 20, unit: "pc", actor: "TEST" });
  const invoice = await t.issue([{ productId: product.id, description: "TEST Banner", quantity: 3, unitPrice: 20 }]);
  assert.equal(invoice.lines[0].productCode, "P0001");
  await t.open().saveProduct({ id: product.id, description: "TEST Banner XL", defaultUnitPrice: 99, unit: "set", actor: "TEST" });
  await t.open().saveCustomer({ id: t.client.id, companyNameEn: "Renamed Co.", vatin: "K999", actor: "TEST" });
  const again = (await t.snap()).taxInvoices!.find((i) => i.id === invoice.id)!;
  assert.deepEqual(again, invoice);
  assert.equal(again.lines[0].description, "TEST Banner");
  assert.equal(again.customer.companyNameEn, CUSTOMER.companyNameEn);
});

test("V3-billed lines stay billed; invoices issued before invoice management get allocations and history", async () => {
  const t = await env();
  const legacy = await t.billing("TEST V3 billed", 80);
  const old = await t.billing("TEST old V5 invoice", 120);
  const at = "2026-09-29T08:00:00.000Z";
  await t.edit((db) => {
    // A V3 "Mark billed" line: INVOICED through a ledger entry, no V5 invoice.
    const v3 = db.billingItems.find((i) => i.id === legacy.line.id)!;
    v3.billingStatus = "INVOICED";
    v3.invoiceId = "v3-ledger";
    // An invoice issued by V5 before this change: lines, no allocations or revisions.
    const record: TaxInvoiceRecord = {
      id: "old-invoice", projectId: old.project.id, clientId: t.client.id, ledgerInvoiceId: "old-ledger", invoiceNumber: "CIJDTI2026081",
      invoiceDate: "2026-09-29", status: "ISSUED", customer: CUSTOMER, project: { name: "TEST old", note: "" },
      lines: [{ billingItemId: old.line.id, description: "TEST old", quantity: 1, unitPrice: 120, amount: 120 }],
      vatApplicable: true, vatPercent: 10, subtotalUsd: 120, vatUsd: 12, totalUsd: 132, exchangeRate: 4105,
      exchangeRateSource: "NBC", exchangeRateEffectiveDate: "2026-09-29", totalKhr: 541860, issuedAt: at, issuedBy: "Accounting",
      cancelledAt: null, cancelledBy: null, cancellationReason: null,
    };
    db.taxInvoices!.push(record);
    const oldLine = db.billingItems.find((i) => i.id === old.line.id)!;
    oldLine.billingStatus = "INVOICED";
  });
  // Any write runs the backfill; reading shows it too.
  await t.open().saveProduct({ description: "TEST trigger write", actor: "TEST" });
  const s = await t.snap();
  assert.deepEqual(
    s.billingAllocations!.filter((a) => a.invoiceId === "old-invoice").map((a) => [a.id, a.amount]),
    [[`alloc:old-invoice:${old.line.id}`, 120]],
  );
  assert.equal(s.invoiceRevisions!.filter((r) => r.invoiceId === "old-invoice").length, 1);
  const oldInvoice = s.taxInvoices!.find((i) => i.id === "old-invoice")!;
  assert.deepEqual([oldInvoice.totalUsd, oldInvoice.totalKhr, oldInvoice.invoiceNumber], [132, 541860, "CIJDTI2026081"]);
  assert.equal(billingState(s, s.billingItems.find((i) => i.id === legacy.line.id)!).state, "LEGACY_BILLED");
  assert.equal(billingState(s, s.billingItems.find((i) => i.id === old.line.id)!).state, "FULLY_INVOICED");
  await rejectsWith(t.issue([{ billingItemId: legacy.line.id, amount: 80 }]), "ALREADY_BILLED");
  // The next number continues after the old one; running the backfill again adds nothing.
  assert.equal((await t.issue([{ description: "TEST next", quantity: 1, unitPrice: 1 }])).invoiceNumber, "CIJDTI2026082");
  assert.equal((await t.snap()).billingAllocations!.filter((a) => a.invoiceId === "old-invoice").length, 1);
});
