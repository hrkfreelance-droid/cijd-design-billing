import assert from "node:assert/strict";
import { test } from "node:test";
import { d1Persistence } from "../../src/lib/billing-v5/d1-persistence.ts";
import { buildV5Seed } from "../../src/lib/billing-v5/repository.ts";
import { eligibleBilling } from "../../src/lib/billing-v5/ontology.ts";
import { RuleError } from "../../src/lib/data/repository.ts";
import { Store } from "../../src/lib/data/store.ts";
import { sqliteD1 } from "./d1-sqlite.ts";

async function setup() {
  const d1 = sqliteD1();
  const open = () => new Store(d1Persistence(d1, buildV5Seed));
  const client = await open().createClient({ name: "Standard customer" });
  const make = async (name: string, amount = 100) => {
    const project = await open().createProject({ clientId: client.id, name });
    const line = await open().createBillingItem({
      projectId: project.id, description: "Design", type: "DESIGN", quantity: 1, amount, finalMode: "MANUAL",
    });
    await open().setProjectBillingReadiness(project.id, "READY");
    await open().setProjectBillingReadiness(project.id, "ACCOUNTING");
    return { project, line };
  };
  return { d1, open, client, make };
}

async function rejected(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => e instanceof RuleError && e.code === code);
}

test("No invoice closes only selected billings, without tax invoice number, VAT or payment; reverse restores", async () => {
  const { open, client, make } = await setup();
  const a = await make("Site", 100);
  const b = await make("Menu", 50);
  const before = await open().getSnapshot();
  const issue = await open().issueNoInvoice({ clientId: client.id, billingItemIds: [a.line.id], actor: "Accounting" });
  assert.equal(issue.amountUsd, 100);
  assert.equal(issue.status, "ISSUED");
  const state = await open().getSnapshot();
  assert.equal(state.taxInvoices?.length, 0);
  assert.equal(state.invoices.length, 0);
  assert.equal(state.invoicePayments?.length, 0);
  assert.equal(state.noInvoiceIssues?.length, 1);
  assert.equal(state.billingAllocations?.length, 1);
  assert.equal(eligibleBilling(state).some((entry) => entry.item.id === a.line.id), false);
  assert.equal(eligibleBilling(state).some((entry) => entry.item.id === b.line.id), true);
  assert.equal(state.billingItems.find((item) => item.id === a.line.id)?.amount, before.billingItems.find((item) => item.id === a.line.id)?.amount);
  const reverted = await open().cancelNoInvoice(issue.id, "Accounting");
  assert.equal(reverted.status, "CANCELLED");
  const after = await open().getSnapshot();
  assert.equal(after.noInvoiceIssues?.[0].status, "CANCELLED");
  assert.equal(eligibleBilling(after).some((entry) => entry.item.id === a.line.id), true);
  assert.equal(after.taxInvoices?.length, 0);
  await rejected(open().cancelNoInvoice(issue.id, "Accounting"), "ALREADY_VOID");
});

test("No invoice rejects duplicate issue, wrong customer, and repeated selection atomically", async () => {
  const { open, client, make } = await setup();
  const a = await make("A");
  await rejected(open().issueNoInvoice({ clientId: "not-customer", billingItemIds: [a.line.id], actor: "TEST" }), "INVALID");
  await rejected(open().issueNoInvoice({ clientId: client.id, billingItemIds: [a.line.id, a.line.id], actor: "TEST" }), "INVALID");
  const first = await open().issueNoInvoice({ clientId: client.id, billingItemIds: [a.line.id], actor: "TEST" });
  await rejected(open().issueNoInvoice({ clientId: client.id, billingItemIds: [a.line.id], actor: "TEST" }), "ALREADY_INVOICED");
  const after = await open().getSnapshot();
  assert.equal(after.noInvoiceIssues?.filter((i) => i.status === "ISSUED").length, 1);
  assert.equal(after.noInvoiceIssues?.[0].id, first.id);
  assert.equal(after.billingAllocations?.filter((i) => !i.voidedAt).length, 1);
});

test("safe delete removes only unbilled and unpaid work; retains records for audit", async () => {
  const { open, client, make } = await setup();
  const a = await make("Delete me");
  await open().deleteUninvoicedV5Project(a.project.id, "TEST");
  let state = await open().getSnapshot();
  assert.equal(state.projects.some((entry) => entry.id === a.project.id), false);
  assert.equal(state.billingItems.some((entry) => entry.id === a.line.id), false);
  assert.equal(state.noInvoiceIssues?.length, 0);
  await rejected(open().deleteUninvoicedV5Project(a.project.id, "TEST"), "NOT_FOUND");
  const b = await make("Keep invoiced");
  const issue = await open().issueNoInvoice({ clientId: client.id, billingItemIds: [b.line.id], actor: "TEST" });
  await rejected(open().deleteUninvoicedV5Project(b.project.id, "TEST"), "PROJECT_LOCKED");
  await open().cancelNoInvoice(issue.id, "TEST");
  await rejected(open().deleteUninvoicedV5Project(b.project.id, "TEST"), "PROJECT_LOCKED");
  const c = await make("Keep paid");
  await open().addProjectPayment({ projectId: c.project.id, kind: "PARTIAL", amount: 20 });
  await rejected(open().deleteUninvoicedV5Project(c.project.id, "TEST"), "PROJECT_LOCKED");
  state = await open().getSnapshot();
  assert.equal(state.projects.some((entry) => entry.id === b.project.id), true);
  assert.equal(state.projects.some((entry) => entry.id === c.project.id), true);
});

test("safe delete cannot remove a real issued Tax Invoice or its billing project", async () => {
  const { d1, open, client, make } = await setup();
  const work = await make("Real tax invoice");
  const persistence = d1Persistence(d1, buildV5Seed);
  const db = (await persistence.read())!;
  db.exchangeRates.push({
    id: "nbc-2026-10-30", currencyPair: "USD/KHR", rate: 4081,
    source: "NBC", effectiveDate: "2026-10-30", fetchedAt: "2026-10-30T10:00:00Z",
  });
  await persistence.write(db);
  const issued = await open().issueInvoice({
    customerId: client.id, invoiceDate: "2026-10-30",
    customer: { companyNameEn: "Standard customer Ltd." },
    items: [{ billingItemId: work.line.id, description: "Design", quantity: 1, unitPrice: 100, amount: 100 }],
    actor: "TEST",
  });
  assert.equal(issued.status, "ISSUED");
  await rejected(open().deleteUninvoicedV5Project(work.project.id, "TEST"), "PROJECT_LOCKED");
  const snap = await open().getSnapshot();
  assert.ok(snap.taxInvoices?.some((invoice) => invoice.id === issued.id));
  assert.ok(snap.projects.some((project) => project.id === work.project.id));
});
