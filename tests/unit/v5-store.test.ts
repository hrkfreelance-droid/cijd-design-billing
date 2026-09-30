import assert from "node:assert/strict";
import { test } from "node:test";

import { toBoardProject } from "../../src/lib/billing-v2/board.ts";
import { d1Persistence } from "../../src/lib/billing-v5/d1-persistence.ts";
import { buildV5Seed } from "../../src/lib/billing-v5/repository.ts";
import { RuleError } from "../../src/lib/data/repository.ts";
import { Store } from "../../src/lib/data/store.ts";
import { sqliteD1 } from "./d1-sqlite.ts";

/** Every `open()` is a fresh Store over the same SQLite file: a reload. */
function v5() {
  const d1 = sqliteD1();
  return { d1, open: () => new Store(d1Persistence(d1, buildV5Seed)) };
}

async function item(open: () => Store, id: string) {
  return (await open().getSnapshot()).billingItems.find((entry) => entry.id === id)!;
}

async function rejectsWith(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => error instanceof RuleError && error.code === code);
}

async function setup() {
  const env = v5();
  const client = await env.open().createClient({ name: "E2E Test Customer" });
  const project = await env.open().createProject({ clientId: client.id, name: "Test project" });
  return { ...env, client, project };
}

test("a fresh V5 database starts from V5's own empty seed", async () => {
  const { open, d1 } = v5();
  const snap = await open().getSnapshot();
  assert.equal(snap.clients.length, 0);
  assert.equal(snap.projects.length, 0);
  assert.deepEqual(snap.taxInvoices, []);
  // Nothing is written until the first change.
  assert.equal((d1.raw.prepare("SELECT version FROM v5_meta").get() as { version: number }).version, 0);
});

test("explicit AUTO: cost 120 → 156, markup override moves it, and both survive reload", async () => {
  const { open, project } = await setup();
  const line = await open().createBillingItem({
    projectId: project.id, description: "Flyers", type: "PRINT", serviceType: "PRINTING", quantity: 2, printCost: 120, finalMode: "AUTO",
  });
  assert.equal(line.amount, 156);
  assert.equal((await item(open, line.id)).finalMode, "AUTO");

  await open().setBillingItemMarkup(line.id, 35);
  let stored = await item(open, line.id);
  assert.equal(stored.markupOverride, 35);
  assert.equal(stored.amount, 162); // 120 × 1.35

  await open().updatePrintSpec(line.id, { printCost: 80 });
  stored = await item(open, line.id);
  assert.equal(stored.amount, 108); // 80 × 1.35 — override kept its meaning
  assert.equal(stored.markupOverride, 35);
});

test("manual Final 150 (Recommended 156) survives cost and markup changes; quantity keeps the unit", async () => {
  const { open, project } = await setup();
  const line = await open().createBillingItem({
    projectId: project.id, description: "Banner", type: "PRINT", serviceType: "PRINTING", quantity: 1, printCost: 120, finalMode: "AUTO",
  });
  await open().overrideBillingUnitPrice(line.id, 150, 150);
  assert.equal((await item(open, line.id)).finalMode, "MANUAL");

  await open().updatePrintSpec(line.id, { printCost: 200 });
  let stored = await item(open, line.id);
  assert.equal(stored.amount, 150);
  assert.equal(stored.suggestedAmount, 260); // $200 × 1.3 — the recommendation moved
  await open().setBillingItemMarkup(line.id, 60);
  stored = await item(open, line.id);
  assert.equal(stored.amount, 150);

  await open().updatePrintSpec(line.id, { quantity: 2, printCost: 400 });
  stored = await item(open, line.id);
  assert.equal(stored.unitPrice, 150);
  assert.equal(stored.amount, 300);
});

test("a manual Final that is not unit × qty to the cent is left exactly as typed", async () => {
  const { open, project } = await setup();
  const line = await open().createBillingItem({
    projectId: project.id, description: "Stickers", type: "PRINT", serviceType: "PRINTING", quantity: 170, printCost: 200, finalMode: "AUTO",
  });
  await open().overrideBillingUnitPrice(line.id, 1.79, 305);
  await open().updatePrintSpec(line.id, { printCost: 210 });
  assert.equal((await item(open, line.id)).amount, 305);
});

test("quantity: Unit Final 305 × 2 = 610, then × 3 = 915", async () => {
  const { open, project } = await setup();
  const line = await open().createBillingItem({
    projectId: project.id, description: "Logo", type: "DESIGN", serviceType: "DESIGN", quantity: 2, amount: 610, finalMode: "MANUAL",
  });
  await open().overrideBillingUnitPrice(line.id, 305, 610);
  await open().updateBillingItem(line.id, { quantity: 3 });
  const stored = await item(open, line.id);
  assert.equal(stored.unitPrice, 305);
  assert.equal(stored.amount, 915);
});

test("Use recommended returns a manual line to AUTO, then it follows cost", async () => {
  const { open, project } = await setup();
  const line = await open().createBillingItem({
    projectId: project.id, description: "Poster", type: "PRINT", serviceType: "PRINTING", quantity: 1, printCost: 120, finalMode: "AUTO",
  });
  await open().overrideBillingPrice(line.id, 150);
  await open().updateBillingItem(line.id, { finalMode: "AUTO", confirmPrice: true });
  let stored = await item(open, line.id);
  assert.equal(stored.finalMode, "AUTO");
  assert.equal(stored.amount, 156);
  assert.equal(stored.priceReviewStatus, "CONFIRMED");
  await open().updatePrintSpec(line.id, { printCost: 80 });
  stored = await item(open, line.id);
  assert.equal(stored.amount, 112);
});

test("payments: 1200 − deposit 500 = 700, + 300 = 400, same after reload", async () => {
  const { open, project } = await setup();
  await open().createBillingItem({
    projectId: project.id, description: "Brand book", type: "DESIGN", serviceType: "DESIGN", quantity: 1, amount: 1200, finalMode: "MANUAL",
  });
  const balance = async () => {
    const snap = await open().getSnapshot();
    const stored = snap.projects.find((entry) => entry.id === project.id)!;
    return toBoardProject(stored, snap.billingItems.filter((entry) => entry.projectId === project.id), snap).balance;
  };
  const deposit = await open().addProjectPayment({ projectId: project.id, kind: "DEPOSIT", amount: 500 });
  assert.equal((await balance()).remaining, 700);
  await open().addProjectPayment({ projectId: project.id, kind: "PARTIAL", amount: 300 });
  assert.equal((await balance()).remaining, 400);
  assert.equal((await balance()).remaining, 400);
  await open().voidProjectPayment(deposit.id);
  assert.equal((await balance()).remaining, 900);
  await rejectsWith(open().addProjectPayment({ projectId: project.id, kind: "PARTIAL", amount: -1 }), "INVALID");
});

async function readyProject() {
  const env = await setup();
  const { open, project } = env;
  const design = await open().createBillingItem({
    projectId: project.id, description: "Logo design", type: "DESIGN", serviceType: "DESIGN", quantity: 2, amount: 610, finalMode: "MANUAL",
  });
  await open().overrideBillingUnitPrice(design.id, 305, 610);
  const print = await open().createBillingItem({
    projectId: project.id, description: "Flyers A5", type: "PRINT", serviceType: "PRINTING", quantity: 500, printCost: 120, finalMode: "AUTO",
  });
  await open().updateBillingItem(print.id, { finalMode: "AUTO", confirmPrice: true });
  await open().setProjectBillingReadiness(project.id, "READY");
  return { ...env, design, print };
}

/** Stores an official NBC rate in V5's history, as the daily cron does. */
export async function storeRate(d1: ReturnType<typeof sqliteD1>, effectiveDate: string, rate: number) {
  const persistence = d1Persistence(d1, buildV5Seed);
  const db = (await persistence.read())!;
  db.exchangeRates.push({ id: `nbc-${effectiveDate}`, currencyPair: "USD/KHR", rate, source: "NBC", effectiveDate, fetchedAt: `${effectiveDate}T10:00:00Z` });
  await persistence.write(db);
}

const CUSTOMER = { companyNameEn: "E2E Test Customer Co., Ltd.", companyNameKm: "ក្រុមហ៊ុន តេស្ត", addressEn: "Phnom Penh", addressKm: "ភ្នំពេញ", telephone: "012 345 678", vatin: "K001-123456789" };

function input(env: Awaited<ReturnType<typeof readyProject>>, extra: Record<string, unknown> = {}) {
  return {
    customerId: env.client.id,
    invoiceDate: "2026-09-29",
    customer: CUSTOMER,
    items: [
      { billingItemId: env.design.id, description: "Logo design", quantity: 2, unitPrice: 305, amount: 610 },
      { billingItemId: env.print.id, description: "Flyers A5", quantity: 500, unitPrice: 0.31, amount: 156 },
    ],
    actor: "Accounting",
    ...extra,
  };
}

test("issue: Final amounts become the lines; VAT, USD and KHR; snapshot survives later edits", async () => {
  const env = await readyProject();
  const { open, project, client, design, d1 } = env;
  await storeRate(d1, "2026-09-29", 4105);
  const issued = await open().issueInvoice(input(env));
  assert.equal(issued.invoiceNumber, "CIJDTI2026081");
  assert.deepEqual(
    issued.lines.map(({ description, quantity, unitPrice, amount }) => ({ description, quantity, unitPrice, amount })),
    [
      { description: "Logo design", quantity: 2, unitPrice: 305, amount: 610 },
      { description: "Flyers A5", quantity: 500, unitPrice: 0.31, amount: 156 },
    ],
  );
  assert.equal(issued.subtotalUsd, 766);
  assert.equal(issued.vatUsd, 76.6);
  assert.equal(issued.totalUsd, 842.6);
  assert.equal(issued.totalKhr, 3458873);
  assert.equal(issued.exchangeRateSource, "NBC");

  // Billed: the lines are locked and the project leaves the to-invoice list.
  const snap = await open().getSnapshot();
  assert.ok(snap.billingItems.filter((entry) => entry.projectId === project.id).every((entry) => entry.billingStatus === "INVOICED"));
  await rejectsWith(open().overrideBillingPrice(design.id, 1), "ITEM_LOCKED");

  // Later edits to the project and the client do not touch the issued invoice.
  await open().updateProject(project.id, { name: "Renamed project", note: "changed later" });
  await open().updateClient(client.id, { name: "Renamed customer" });
  const reopened = (await open().getSnapshot()).taxInvoices!.find((entry) => entry.id === issued.id)!;
  assert.deepEqual(reopened, issued);
  assert.equal(reopened.project.name, "Test project");

  // The customer's legal details went to the Customer Master.
  assert.equal((await open().getSnapshot()).customers![0].vatin, "K001-123456789");
});

test("issue is refused without a rate, a legal name, or ready work; the number is the system's", async () => {
  const env = await readyProject();
  const { open, d1 } = env;
  await rejectsWith(open().issueInvoice(input(env)), "RATE_REQUIRED"); // no NBC rate stored for the date
  await rejectsWith(open().issueInvoice(input(env, { exchangeRate: { rate: 0, source: "MANUAL" } })), "INVALID");
  await rejectsWith(open().issueInvoice(input(env, { customer: {} , exchangeRate: { rate: 4105, source: "MANUAL" } })), "INVALID");
  const manual = await open().issueInvoice(input(env, { invoiceNumber: "WHATEVER-1", exchangeRate: { rate: 4105, source: "MANUAL" } }));
  assert.equal(manual.invoiceNumber, "CIJDTI2026081"); // a requested number is not used
  assert.equal(manual.exchangeRateSource, "MANUAL");
  await storeRate(d1, "2026-09-29", 4105);

  const unready = await open().createProject({ clientId: env.client.id, name: "Unpriced" });
  const line = await open().createBillingItem({ projectId: unready.id, description: "x", type: "DESIGN", serviceType: "DESIGN", quantity: 1, finalMode: "MANUAL" });
  await rejectsWith(open().issueInvoice({ ...input(env), items: [{ billingItemId: line.id, description: "x", quantity: 1, unitPrice: 0 }] }), "NOT_READY");
});

test("the issued invoice is archived immutably in D1; cancel keeps the record", async () => {
  const env = await readyProject();
  const { open, project, d1 } = env;
  await storeRate(d1, "2026-09-29", 4105);
  const issued = await open().issueInvoice(input(env));
  const row = d1.raw.prepare("SELECT snapshot FROM v5_tax_invoice_archive WHERE id = ?").get(issued.id) as { snapshot: string };
  assert.deepEqual(JSON.parse(row.snapshot), issued);
  assert.throws(() => d1.raw.prepare("UPDATE v5_tax_invoice_archive SET snapshot = '{}'").run(), /immutable/);
  assert.throws(() => d1.raw.prepare("DELETE FROM v5_tax_invoice_archive").run(), /immutable/);

  // Cancelling keeps the record (and the archive) and returns the work to Accounting.
  await open().cancelTaxInvoice(issued.id, "Wrong customer name");
  const snap = await open().getSnapshot();
  assert.equal(snap.taxInvoices![0].status, "CANCELLED");
  assert.equal(snap.taxInvoices![0].invoiceNumber, "CIJDTI2026081");
  assert.ok(snap.billingItems.filter((entry) => entry.projectId === project.id).every((entry) => entry.billingStatus === "READY_TO_INVOICE"));
  assert.equal((d1.raw.prepare("SELECT count(*) AS n FROM v5_tax_invoice_archive").get() as { n: number }).n, 1);
});

test("a stale write is refused instead of overwriting someone else's save", async () => {
  const { d1, open, project } = await setup();
  const a = new Store(d1Persistence(d1, buildV5Seed));
  // Both writers read the same version…
  const stale = d1Persistence(d1, buildV5Seed);
  const copy = (await stale.read())!;
  await a.updateProject(project.id, { note: "first" });
  copy.projects[0].note = "second";
  await assert.rejects(stale.write(copy), (error: unknown) => error instanceof RuleError && error.code === "CONFLICT");
  assert.equal((await open().getSnapshot()).projects[0].note, "first");
});

test("audit entries are appended to their own table", async () => {
  const { d1 } = await setup();
  const n = (d1.raw.prepare("SELECT count(*) AS n FROM v5_audit_log").get() as { n: number }).n;
  assert.equal(n, 2); // client.create + project.create
});
