import assert from "node:assert/strict";
import { test } from "node:test";

import { d1Persistence } from "../../src/lib/billing-v5/d1-persistence.ts";
import { balanceDueUsd, DISCOUNT_VAT_POLICY, invoiceTotals, taxTotals } from "../../src/lib/billing-v5/calculation.ts";
import { billingState, eligibleBilling, invoiceCollection, officialRateForDate } from "../../src/lib/billing-v5/ontology.ts";
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
    await open().setProjectBillingReadiness(project.id, "ACCOUNTING");
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
  // The code is the system's: a code sent by a client is ignored, never taken.
  assert.equal((await open().saveCustomer({ id: created.id, customerCode: "C0001", actor: "TEST" })).customerCode, "C0002");
  assert.equal((await open().saveCustomer({ name: "TEST Third", customerCode: "C0999", actor: "TEST" })).customerCode, "C0003");

  const product = await open().saveProduct({ description: "Logo design", defaultUnitPrice: 300, unit: "set", actor: "TEST" });
  assert.equal(product.productCode, "P0001");
  await rejectsWith(open().saveProduct({ description: "logo design", actor: "TEST" }), "DUPLICATE_PRODUCT");
  const edited = await open().saveProduct({ id: product.id, defaultUnitPrice: 320, actor: "TEST" });
  assert.equal(edited.defaultUnitPrice, 320);
  assert.equal(edited.description, "Logo design");
});

test("customer codes: every client gets one (max + 1, creation order), never reused, never changed; inactive customers cannot be invoiced", async () => {
  const t = await env();
  const codes = async () => new Map((await t.snap()).customers!.map((c) => [c.id, c.customerCode]));
  await t.open().saveProduct({ description: "TEST any write", actor: "TEST" }); // any write runs the back-fill
  const envCode = (await codes()).get(t.client.id);
  assert.match(envCode ?? "", /^C\d{4}$/);
  // A higher code was issued before (an inactive customer): new codes go after it.
  await t.edit((db) => {
    db.customers!.push({ ...db.customers![0], id: "gone", customerCode: "C0007", companyNameEn: "Inactive old", active: false });
  });
  // Two clients made on the Billing screens (no Customer Master record yet), in this order.
  await t.edit((db) => {
    db.clients.push({ id: "b-later", name: "TEST Code B", active: true, createdAt: "2026-09-02T00:00:00.000Z" });
    db.clients.push({ id: "a-first", name: "TEST Code A", active: true, createdAt: "2026-09-01T00:00:00.000Z" });
  });
  await t.open().saveProduct({ description: "TEST second write", actor: "TEST" });
  const first = await codes();
  assert.deepEqual([first.get(t.client.id), first.get("gone"), first.get("a-first"), first.get("b-later")], [envCode, "C0007", "C0008", "C0009"]);
  await t.open().saveProduct({ description: "TEST third write", actor: "TEST" });
  assert.deepEqual(await codes(), first); // idempotent
  assert.equal((await t.open().saveCustomer({ name: "TEST Code C", actor: "TEST" })).customerCode, "C0010");
  // Inactive: kept in the master with its code, but not invoiceable.
  await t.open().saveCustomer({ id: "a-first", active: false, actor: "TEST" });
  await rejectsWith(t.open().issueInvoice({ customerId: "a-first", invoiceDate: "2026-09-29", customer: CUSTOMER, actor: "TEST", items: [{ description: "x", quantity: 1, unitPrice: 1 }] }), "CUSTOMER_INACTIVE");
  assert.equal((await codes()).get("a-first"), "C0008");
});

test("edit may change the customer explicitly: snapshot follows; billing lines must be the new customer's; TEST and real series never mix", async () => {
  const t = await env();
  const other = await t.open().saveCustomer({ name: "Other Co", companyNameEn: "Other Co., Ltd.", vatin: "K009", actor: "TEST" });
  const free = await t.issue([{ description: "TEST free", quantity: 1, unitPrice: 10 }]);
  const moved = await t.open().editInvoice(free.id, { customerId: other.id, customer: { ...CUSTOMER, companyNameEn: "Other Co., Ltd.", vatin: "K009" }, actor: "TEST", invoiceDate: free.invoiceDate, items: free.lines.map((l) => ({ ...l, billingItemId: undefined })) });
  assert.deepEqual([moved.clientId, moved.customer.companyNameEn, moved.customer.vatin, moved.invoiceNumber, moved.totalUsd], [other.id, "Other Co., Ltd.", "K009", free.invoiceNumber, 11]);
  const ledger = (await t.snap()).invoices.find((i) => i.id === moved.ledgerInvoiceId);
  if (ledger) assert.equal(ledger.clientId, other.id);
  // Billing lines stay with their own customer.
  const { line } = await t.billing("TEST Billed", 100);
  const billed = await t.issue([{ billingItemId: line.id, amount: 100 }]);
  await rejectsWith(t.open().editInvoice(billed.id, { customerId: other.id, customer: CUSTOMER, actor: "TEST", invoiceDate: billed.invoiceDate, items: billed.lines.map((l) => ({ ...l, billingItemId: l.billingItemId ?? undefined })) }), "DIFFERENT_CUSTOMER");
  // A real invoice never moves to a TEST customer (nor the other way round).
  const testCustomer = await t.open().saveCustomer({ name: "TEST Customer X", actor: "TEST" });
  await rejectsWith(t.open().editInvoice(free.id, { customerId: testCustomer.id, customer: CUSTOMER, actor: "TEST", invoiceDate: free.invoiceDate, items: free.lines.map((l) => ({ ...l, billingItemId: undefined })) }), "SERIES_MISMATCH");
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

test("each billed line keeps its project name as issued; free lines and older invoices have none", async () => {
  const t = await env();
  const a = await t.billing("TEST Project A", 100);
  const b = await t.billing("TEST Project B", 250);
  const invoice = await t.issue([
    { billingItemId: a.line.id, amount: 100, description: "Printing" },
    { billingItemId: b.line.id, amount: 250, description: "A3 custom" },
    { description: "TEST free", quantity: 1, unitPrice: 5 },
  ]);
  assert.deepEqual(invoice.lines.map((line) => [line.projectName, line.description]), [["TEST Project A", "Printing"], ["TEST Project B", "A3 custom"], [undefined, "TEST free"]]);
  assert.deepEqual([invoice.subtotalUsd, invoice.vatUsd, invoice.totalUsd], [355, 35.5, 390.5]); // totals as before

  // A later project rename never reaches the issued invoice, nor an edit of it.
  await t.open().updateProject(a.project.id, { name: "TEST Project A renamed" });
  assert.equal((await t.snap()).taxInvoices!.find((i) => i.id === invoice.id)!.lines[0].projectName, "TEST Project A");
  const edited = await t.open().editInvoice(invoice.id, {
    customerId: t.client.id, customer: CUSTOMER, actor: "TEST", invoiceDate: invoice.invoiceDate,
    items: invoice.lines.map((line) => ({ ...line, billingItemId: line.billingItemId ?? undefined })),
  });
  assert.equal(edited.lines[0].projectName, "TEST Project A");

  // An invoice issued before project names were recorded keeps printing the description only.
  await t.edit((db) => {
    const stored = db.taxInvoices!.find((i) => i.id === invoice.id)!;
    for (const line of stored.lines) delete line.projectName;
  });
  const legacy = await t.open().editInvoice(invoice.id, {
    customerId: t.client.id, customer: CUSTOMER, actor: "TEST", invoiceDate: invoice.invoiceDate,
    items: invoice.lines.map((line) => ({ ...line, projectName: undefined, billingItemId: line.billingItemId ?? undefined })),
  });
  assert.deepEqual(legacy.lines.map((line) => line.projectName), [undefined, undefined, undefined]);
  assert.equal(legacy.totalUsd, 390.5);
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

test("D. discount policy: BEFORE_VAT (confirmed) — Subtotal → Discount → Taxable → VAT 10% → Grand Total → Deposit → Balance Due", async () => {
  assert.equal(DISCOUNT_VAT_POLICY, "DISCOUNT_BEFORE_VAT");
  const totals = (discount: { type: "FIXED" | "PERCENT"; value: number } | null, deposit = 0, amount = 100) =>
    invoiceTotals({ lines: [{ amount }], discount, vatApplicable: true, exchangeRate: 4100, deposit });
  const row = (t: ReturnType<typeof totals>) => [t.subtotalUsd, t.discountUsd, t.taxableUsd, t.vatUsd, t.totalUsd, t.balanceDueUsd];

  // 1. $100 − 10% = $90 taxable, VAT $9, Grand Total $99.
  assert.deepEqual(row(totals({ type: "PERCENT", value: 10 })), [100, 10, 90, 9, 99, 99]);
  // 2. $100 − fixed $10: the same.
  assert.deepEqual(row(totals({ type: "FIXED", value: 10 })), [100, 10, 90, 9, 99, 99]);
  assert.equal(totals({ type: "FIXED", value: 10 }).discountPolicy, "DISCOUNT_BEFORE_VAT");
  // 3. Deposit $30 is not a discount: VAT stays $9, Balance Due $69.
  const deposit = totals({ type: "PERCENT", value: 10 }, 30);
  assert.deepEqual([deposit.taxableUsd, deposit.vatUsd, deposit.totalUsd, deposit.depositUsd, deposit.balanceDueUsd], [90, 9, 99, 30, 69]);
  assert.equal(balanceDueUsd(99, 30), 69);
  // 4. Never below zero: the engine caps at the subtotal; the server refuses more.
  assert.deepEqual(row(totals({ type: "FIXED", value: 150 })), [100, 100, 0, 0, 0, 0]);
  assert.deepEqual(row(totals({ type: "PERCENT", value: 250 })), [100, 100, 0, 0, 0, 0]);
  // Rounding: percent discount half-up to the cent, VAT on the discounted amount.
  const pct = invoiceTotals({ lines: [{ amount: 333.33 }], discount: { type: "PERCENT", value: 12.5 }, vatApplicable: true, exchangeRate: 4105 });
  assert.deepEqual([pct.discountUsd, pct.taxableUsd, pct.vatUsd, pct.totalUsd], [41.67, 291.66, 29.17, 320.83]);
  // 5. Without a discount: exactly the existing VAT 10% totals, and no policy recorded.
  const lines = [{ amount: 400 }];
  for (const discount of [undefined, null, { type: "FIXED" as const, value: 0 }]) {
    const plain = invoiceTotals({ lines, discount, vatApplicable: true, exchangeRate: 4105, deposit: 100 });
    const legacy = taxTotals({ lines, vatApplicable: true, exchangeRate: 4105 });
    assert.deepEqual([plain.subtotalUsd, plain.vatPercent, plain.vatUsd, plain.totalUsd, plain.totalKhr], [legacy.subtotalUsd, legacy.vatPercent, legacy.vatUsd, legacy.totalUsd, legacy.totalKhr]);
    assert.deepEqual([plain.discountUsd, plain.taxableUsd, plain.balanceDueUsd, plain.discountPolicy], [0, 400, 340, null]);
  }

  // Through the server: issued with the discount, stored as calculated.
  const t = await env();
  const { line } = await t.billing("TEST Discount", 1000);
  const pctInvoice = await t.issue([{ billingItemId: line.id, amount: 100 }], { discount: { type: "PERCENT", value: 10 }, depositUsd: 30 });
  assert.deepEqual(
    [pctInvoice.subtotalUsd, pctInvoice.discountUsd, pctInvoice.taxableUsd, pctInvoice.vatUsd, pctInvoice.totalUsd, pctInvoice.depositUsd, pctInvoice.totalKhr, pctInvoice.discountPolicy],
    [100, 10, 90, 9, 99, 30, 406395, "DISCOUNT_BEFORE_VAT"],
  );
  assert.deepEqual(pctInvoice.discount, { type: "PERCENT", value: 10 });
  assert.equal(invoiceCollection(await t.snap(), pctInvoice).outstandingUsd, 69);
  const fixedInvoice = await t.issue([{ billingItemId: line.id, amount: 100 }], { discount: { type: "FIXED", value: 10 } });
  assert.deepEqual([fixedInvoice.taxableUsd, fixedInvoice.vatUsd, fixedInvoice.totalUsd], [90, 9, 99]);
  await rejectsWith(t.issue([{ billingItemId: line.id, amount: 10 }], { discount: { type: "FIXED", value: 11 } }), "INVALID");
  await rejectsWith(t.issue([{ billingItemId: line.id, amount: 10 }], { discount: { type: "PERCENT", value: 101 } }), "INVALID");
  await rejectsWith(t.issue([{ billingItemId: line.id, amount: 10 }], { discount: { type: "FIXED", value: -1 } }), "INVALID");
  // A deposit larger than the discounted Grand Total is refused.
  await rejectsWith(t.issue([{ billingItemId: line.id, amount: 100 }], { discount: { type: "FIXED", value: 10 }, depositUsd: 99.01 }), "INVALID");
  // Without a discount: VAT 10% exactly as before.
  const plain = await t.issue([{ billingItemId: line.id, amount: 400 }], { depositUsd: 100 });
  assert.deepEqual([plain.subtotalUsd, plain.discountUsd, plain.vatUsd, plain.totalUsd, plain.depositUsd, plain.discountPolicy, plain.discount], [400, 0, 40, 440, 100, null, null]);
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

test("A. edit with the invoice date unchanged never changes the saved rate; number fixed; history kept", async () => {
  const t = await env();
  const { line } = await t.billing("TEST Edit", 1000);
  const invoice = await t.issue([{ billingItemId: line.id, amount: 500, description: "First" }]);
  assert.deepEqual([invoice.exchangeRate, invoice.exchangeRateSource, invoice.exchangeRateBasis, invoice.exchangeRateForDate], [4105, "NBC", "EXACT", "2026-09-29"]);
  const base = { customerId: t.client.id, customer: CUSTOMER, actor: "TEST" };

  // NBC's stored rate for that same date changes (re-fetched), and a newer one appears:
  // an edit that keeps the date keeps 4105, even when it sends another rate.
  await t.edit((db) => {
    db.exchangeRates.find((r) => r.effectiveDate === "2026-09-29")!.rate = 4999;
  });
  await t.rate("2026-10-01", 4200);
  const same = await t.open().editInvoice(invoice.id, { ...base, invoiceDate: "2026-09-29", exchangeRate: { rate: 1, source: "MANUAL" }, items: [{ billingItemId: line.id, description: "First, corrected", quantity: 1, unitPrice: 600, amount: 600 }], reason: "TEST price" });
  assert.deepEqual([same.exchangeRate, same.exchangeRateSource, same.exchangeRateEffectiveDate, same.exchangeRateBasis], [4105, "NBC", "2026-09-29", "EXACT"]);
  assert.equal(same.invoiceNumber, invoice.invoiceNumber);
  assert.equal(same.revision, 2);
  assert.deepEqual([same.totalUsd, same.totalKhr], [660, 2709300]); // 600 × 1.1 × 4105

  await rejectsWith(t.open().editInvoice(invoice.id, { ...base, invoiceNumber: "CIJDTI2026999", invoiceDate: "2026-09-29", items: [{ billingItemId: line.id, description: "x", quantity: 1, unitPrice: 600, amount: 600 }] }), "NUMBER_IMMUTABLE");
  await rejectsWith(t.open().editInvoice(invoice.id, { ...base, invoiceDate: "2026-09-29", items: [{ billingItemId: line.id, description: "x", quantity: 1, unitPrice: 1001, amount: 1001 }] }), "OVER_ALLOCATION");

  const s = await t.snap();
  const revisions = s.invoiceRevisions!.filter((r) => r.invoiceId === invoice.id).sort((a, b) => a.revision - b.revision);
  assert.deepEqual(revisions.map((r) => [r.revision, r.action]), [[1, "ISSUE"], [2, "EDIT"]]);
  assert.equal(revisions[1].previousSnapshot!.lines[0].description, "First");
  assert.equal(revisions[1].reason, "TEST price");
  assert.equal(billingState(s, s.billingItems.find((i) => i.id === line.id)!).remainingUsd, 400);
  assert.equal((t.d1.raw.prepare("SELECT count(*) AS n FROM v5_invoice_revisions WHERE invoice_id = ?").get(invoice.id) as { n: number }).n, 2);
  assert.throws(() => t.d1.raw.prepare("DELETE FROM v5_invoice_revisions").run(), /immutable/);
  assert.throws(() => t.d1.raw.prepare("UPDATE v5_invoice_revisions SET action = 'X'").run(), /immutable/);
});

test("B. date changed and NBC has a rate for exactly that date → that rate", async () => {
  const t = await env();
  const { line } = await t.billing("TEST Rate B", 1000);
  const invoice = await t.issue([{ billingItemId: line.id, amount: 500 }]);
  await t.rate("2026-10-01", 4200);
  await t.rate("2026-10-02", 4210);
  const moved = await t.open().editInvoice(invoice.id, { customerId: t.client.id, customer: CUSTOMER, actor: "TEST", invoiceDate: "2026-10-01", items: [{ billingItemId: line.id, description: "Work", quantity: 1, unitPrice: 500, amount: 500 }] });
  assert.deepEqual([moved.exchangeRate, moved.exchangeRateSource, moved.exchangeRateEffectiveDate, moved.exchangeRateBasis, moved.exchangeRateForDate], [4200, "NBC", "2026-10-01", "EXACT", "2026-10-01"]);
  assert.equal(moved.totalKhr, 2310000); // 550 × 4200
});

test("C. date changed and NBC has no rate for that date → no look-back, manual rate required and saved for that date", async () => {
  const t = await env();
  const { line } = await t.billing("TEST Rate C", 1000);
  const invoice = await t.issue([{ billingItemId: line.id, amount: 500 }]);
  const base = { customerId: t.client.id, customer: CUSTOMER, actor: "TEST", items: [{ billingItemId: line.id, description: "Work", quantity: 1, unitPrice: 500, amount: 500 }] };
  // 2026-09-30 is one day after a stored rate, but NBC was never seen reporting it on the 30th.
  assert.equal(officialRateForDate((await t.snap()).exchangeRates ?? [], "2026-09-30"), null);
  await rejectsWith(t.open().editInvoice(invoice.id, { ...base, invoiceDate: "2026-09-30" }), "RATE_REQUIRED");
  await rejectsWith(t.issue([{ description: "TEST", quantity: 1, unitPrice: 1 }], { invoiceDate: "2026-10-03" }), "RATE_REQUIRED");
  // Refused edits change nothing.
  assert.equal((await t.snap()).taxInvoices!.find((i) => i.id === invoice.id)!.exchangeRate, 4105);
  const manual = await t.open().editInvoice(invoice.id, { ...base, invoiceDate: "2026-09-30", exchangeRate: { rate: 4150, source: "MANUAL" } });
  assert.deepEqual(
    [manual.exchangeRate, manual.exchangeRateSource, manual.exchangeRateEffectiveDate, manual.exchangeRateBasis, manual.exchangeRateForDate, manual.invoiceDate],
    [4150, "MANUAL", null, "MANUAL", "2026-09-30", "2026-09-30"],
  );
  // A manual rate is refused when NBC has a rate for the date.
  await rejectsWith(t.issue([{ description: "TEST", quantity: 1, unitPrice: 1 }], { exchangeRate: { rate: 4000, source: "MANUAL" } }), "RATE_AVAILABLE");
});

test("NBC effective-date semantics: a rate NBC still reported on the invoice date applies (IN_EFFECT); otherwise none", () => {
  const nbc = (effectiveDate: string, rate: number, fetchedAt: string) => ({ id: effectiveDate, currencyPair: "USD/KHR" as const, rate, source: "NBC" as const, effectiveDate, fetchedAt });
  // Friday 2 Oct's rate; NBC still reported it as latest on Saturday 08:00 Phnom Penh (01:00Z).
  const rates = [nbc("2026-10-02", 4100, "2026-10-03T01:00:00Z"), nbc("2026-10-05", 4110, "2026-10-05T03:00:00Z")];
  assert.deepEqual(officialRateForDate(rates, "2026-10-02")?.basis, "EXACT");
  assert.deepEqual([officialRateForDate(rates, "2026-10-03")?.rate.rate, officialRateForDate(rates, "2026-10-03")?.basis], [4100, "IN_EFFECT"]);
  // Sunday: nobody saw NBC on the 4th → no rate, whatever the gap.
  assert.equal(officialRateForDate(rates, "2026-10-04"), null);
  // Phnom Penh date, not UTC: 17:30Z on the 3rd is already the 4th in Phnom Penh.
  assert.equal(officialRateForDate([nbc("2026-10-02", 4100, "2026-10-03T17:30:00Z")], "2026-10-04")?.basis, "IN_EFFECT");
  // A future valid_date never applies to an earlier date; nothing before the first rate.
  assert.equal(officialRateForDate(rates, "2026-10-01"), null);
  // Only NBC USD/KHR rates, never another source.
  assert.equal(officialRateForDate([{ ...nbc("2026-10-02", 4100, "2026-10-02T03:00:00Z"), source: "MANUAL" as unknown as "NBC" }], "2026-10-02"), null);
});

test("invoices cannot be deleted: there is no delete operation or route", async () => {
  const store = (await env()).open() as unknown as Record<string, unknown>;
  assert.equal(store.deleteInvoice, undefined);
  assert.equal(store.deleteTaxInvoice, undefined);
  const route = await import("../../src/app/api/v5/tax-invoices/[id]/route.ts").catch(() => null);
  if (route) assert.equal((route as Record<string, unknown>).DELETE, undefined);
});

test("numbers run per year: stored history determines the sequence, 2027 restarts at 001; cancelled numbers are not reused", async () => {
  const t = await env();
  const free = (date: string) => t.issue([{ description: "TEST numbering", quantity: 1, unitPrice: 1 }], { invoiceDate: date });
  const a = await free("2026-09-29");
  const b = await free("2026-12-30");
  await t.open().cancelTaxInvoice(b.id, "TEST");
  const c = await free("2026-12-30");
  const d = await free("2027-01-04");
  const e = await free("2027-01-04");
  assert.deepEqual([a, b, c, d, e].map((i) => i.invoiceNumber), ["CIJDTI2026001", "CIJDTI2026002", "CIJDTI2026003", "CIJDTI2027001", "CIJDTI2027002"]);
});

test("TEST customers are numbered in their own series and never touch the real sequence", async () => {
  const t = await env();
  const testClient = await t.open().createClient({ name: "TEST E2E Customer" });
  const testInvoice = (date: string) =>
    t.open().issueInvoice({ customerId: testClient.id, invoiceDate: date, customer: {...CUSTOMER, vatin:"TEST-VAT"}, items: [{ description: "TEST", quantity: 1, unitPrice: 1 }], actor: "TEST" });
  assert.equal((await testInvoice("2026-09-29")).invoiceNumber, "TEST-CIJDTI2026001");
  assert.equal((await testInvoice("2026-09-29")).invoiceNumber, "TEST-CIJDTI2026002");
  assert.equal((await t.issue([{ description: "Real", quantity: 1, unitPrice: 1 }])).invoiceNumber, "CIJDTI2026001");
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
