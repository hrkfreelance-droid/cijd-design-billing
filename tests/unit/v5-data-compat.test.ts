import assert from "node:assert/strict";
import { test } from "node:test";

import { d1Persistence } from "../../src/lib/billing-v5/d1-persistence.ts";
import { invoiceCollection } from "../../src/lib/billing-v5/ontology.ts";
import { buildV5Seed } from "../../src/lib/billing-v5/repository.ts";
import { RuleError } from "../../src/lib/data/repository.ts";
import { Store } from "../../src/lib/data/store.ts";
import type { Database, TaxInvoiceRecord } from "../../src/lib/types.ts";
import { sqliteD1 } from "./d1-sqlite.ts";

const CUSTOMER = { companyNameEn: "TEST Legacy Co., Ltd.", companyNameKm: "ក្រុមហ៊ុន", addressEn: "Phnom Penh", addressKm: "ភ្នំពេញ", telephone: "012", vatin: "K001-000000000" };
const AT = "2026-09-20T08:00:00.000Z";
const PRE_EXISTING = ["clients", "projects", "billingItems", "invoices", "invoiceItems", "payments", "projectPayments", "taxInvoices", "clientTaxProfiles", "exchangeRates"] as const;

/**
 * F. A V5 database as it stands before invoice management (migration 0001
 * only, pre-IMS records: V3-imported history, invoices 081–083, a ledger
 * payment, project payments) goes through migration 0002 and the IMS
 * back-fill. Every pre-existing record must come out byte-for-byte the same.
 */
test("F. pre-existing V5 data is unchanged by migration 0002 and the back-fill; numbering continues after 083", async () => {
  const d1 = sqliteD1({ through: "0001_v5_state.sql" });
  assert.equal((d1.raw.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'v5_invoice_revisions'").get() as { n: number }).n, 0);
  const open = () => new Store(d1Persistence(d1, buildV5Seed));
  const edit = async (change: (db: Database) => void) => {
    const persistence = d1Persistence(d1, buildV5Seed);
    const db = (await persistence.read())!;
    change(db);
    await persistence.write(db);
  };

  // V3-style history, created the way V3/V5 Billing creates it.
  const client = await open().createClient({ name: "TEST Legacy" });
  const lines: string[] = [];
  const projects: string[] = [];
  for (const [name, amount] of [["TEST paid", 120], ["TEST open", 120], ["TEST cancelled", 50], ["TEST v3 billed", 80]] as const) {
    const project = await open().createProject({ clientId: client.id, name });
    const line = await open().createBillingItem({ projectId: project.id, description: name, type: "DESIGN", serviceType: "DESIGN", quantity: 1, amount, finalMode: "MANUAL" });
    await open().setProjectBillingReadiness(project.id, "READY");
    projects.push(project.id);
    lines.push(line.id);
  }
  await edit((db) => {
    db.exchangeRates.push({ id: "nbc-0920", currencyPair: "USD/KHR", rate: 4100, source: "NBC", effectiveDate: "2026-09-20", fetchedAt: "2026-09-20T03:00:00Z" });
    db.clientTaxProfiles = [{ clientId: client.id, ...CUSTOMER, updatedAt: AT, updatedBy: "Accounting" }];
    const ledger = (id: string, number: string | null, amount: number, status: "ISSUED" | "PAID" | "VOID") => ({
      id, clientId: client.id, invoiceNumber: number, invoiceDate: "2026-09-20", amount, status,
      paymentDate: status === "PAID" ? "2026-09-25" : null, paymentSlip: status === "PAID" ? "slip-081" : null,
      receiptStatus: "NOT_REQUIRED" as const, createdAt: AT, createdBy: "Accounting", updatedAt: AT, updatedBy: "Accounting",
    });
    db.invoices.push(ledger("led-081", "CIJDTI2026081", 120, "PAID"), ledger("led-082", "CIJDTI2026082", 120, "ISSUED"), ledger("led-083", "CIJDTI2026083", 50, "VOID"), ledger("led-v3", "V3-0007", 80, "PAID"));
    db.payments.push(
      { id: "pay-081", invoiceId: "led-081", amount: 120, paidAt: "2026-09-25", slip: "slip-081", createdAt: AT, createdBy: "Accounting", voidedAt: null, voidedBy: null },
      { id: "pay-v3", invoiceId: "led-v3", amount: 80, paidAt: "2026-09-10", slip: null, createdAt: AT, createdBy: "V3", voidedAt: null, voidedBy: null },
    );
    const status = ["PAID", "INVOICED", "READY_TO_INVOICE", "PAID"] as const;
    const ledgerOf = ["led-081", "led-082", null, "led-v3"];
    lines.forEach((id, index) => {
      const item = db.billingItems.find((entry) => entry.id === id)!;
      item.billingStatus = status[index];
      item.invoiceId = ledgerOf[index];
      if (ledgerOf[index]) db.invoiceItems.push({ invoiceId: ledgerOf[index]!, billingItemId: id });
    });
    (db.projectPayments ??= []).push({ id: "pp-1", projectId: projects[1], kind: "PARTIAL", amount: 30, paidOn: "2026-09-26", note: "TEST", createdAt: AT, createdBy: "Accounting", voidedAt: null, voidedBy: null });
    db.projects.find((p) => p.id === projects[1])!.depositAmount = 20;
    const record = (id: string, number: string, line: string, amount: number, ledgerId: string, status: "ISSUED" | "CANCELLED"): TaxInvoiceRecord => ({
      id, projectId: db.billingItems.find((i) => i.id === line)!.projectId, clientId: client.id, ledgerInvoiceId: ledgerId, invoiceNumber: number,
      invoiceDate: "2026-09-20", status, customer: CUSTOMER, project: { name: number, note: "memo kept" },
      lines: [{ billingItemId: line, description: "TEST", quantity: 1, unitPrice: amount, amount }],
      vatApplicable: true, vatPercent: 10, subtotalUsd: amount, vatUsd: amount / 10, totalUsd: Math.round(amount * 110) / 100, exchangeRate: 4100,
      exchangeRateSource: "NBC", exchangeRateEffectiveDate: "2026-09-20", totalKhr: Math.round(amount * 110 * 41), issuedAt: AT, issuedBy: "Accounting",
      cancelledAt: status === "CANCELLED" ? AT : null, cancelledBy: status === "CANCELLED" ? "Accounting" : null, cancellationReason: status === "CANCELLED" ? "TEST" : null,
    });
    db.taxInvoices!.push(
      record("ti-081", "CIJDTI2026081", lines[0], 120, "led-081", "ISSUED"),
      record("ti-082", "CIJDTI2026082", lines[1], 120, "led-082", "ISSUED"),
      record("ti-083", "CIJDTI2026083", lines[2], 50, "led-083", "CANCELLED"),
    );
  });

  const before = (await d1Persistence(d1, buildV5Seed).read())!;
  const frozen = JSON.parse(JSON.stringify(Object.fromEntries(PRE_EXISTING.map((name) => [name, before[name] ?? []]))));
  const archiveBefore = d1.raw.prepare("SELECT * FROM v5_tax_invoice_archive ORDER BY id").all();
  const auditBefore = d1.raw.prepare("SELECT * FROM v5_audit_log ORDER BY rowid").all();

  // Deploy: migration 0002, then the new code reads and writes.
  d1.migrate("0002_v5_invoice_management.sql");
  const fresh = await open().issueInvoice({
    customerId: client.id, invoiceDate: "2026-09-20", customer: CUSTOMER, actor: "TEST",
    items: [{ description: "TEST after migration", quantity: 1, unitPrice: 10 }],
  });
  assert.equal(fresh.invoiceNumber, "TEST-CIJDTI2026001"); // TEST customer: own series
  const realClient = await open().saveCustomer({ name: "Real Co", companyNameEn: "Real Co., Ltd.", actor: "Accounting" });
  const real = await open().issueInvoice({
    customerId: realClient.id, invoiceDate: "2026-09-20", customer: { ...CUSTOMER, companyNameEn: "Real Co., Ltd." }, actor: "Accounting",
    items: [{ description: "After migration", quantity: 1, unitPrice: 10 }],
  });
  assert.equal(real.invoiceNumber, "CIJDTI2026084"); // after 081–083; the cancelled 083 is not reused

  const after = (await d1Persistence(d1, buildV5Seed).read())!;
  for (const name of PRE_EXISTING) {
    for (const original of frozen[name] as { id?: string; clientId?: string; invoiceId?: string; billingItemId?: string }[]) {
      const key = original.id ?? `${original.invoiceId ?? original.clientId}:${original.billingItemId ?? ""}`;
      const current = (after[name] as typeof original[]).find((entry) =>
        (entry.id ?? `${entry.invoiceId ?? entry.clientId}:${entry.billingItemId ?? ""}`) === key);
      assert.deepEqual(current, original, `${name} ${key} changed`);
    }
  }
  // The first-issue archive and the audit log keep every earlier row as it was.
  assert.deepEqual(d1.raw.prepare("SELECT * FROM v5_tax_invoice_archive WHERE id IN ('ti-081','ti-082','ti-083') ORDER BY id").all(), archiveBefore);
  assert.deepEqual(d1.raw.prepare(`SELECT * FROM v5_audit_log ORDER BY rowid LIMIT ${auditBefore.length}`).all(), auditBefore);

  // Billing links back-filled, no V3-billed line becomes billable again.
  const snap = await open().getSnapshot();
  assert.deepEqual(snap.billingAllocations!.filter((a) => a.invoiceId.startsWith("ti-")).map((a) => [a.id, a.amount, !!a.voidedAt]).sort(), [
    [`alloc:ti-081:${lines[0]}`, 120, false], [`alloc:ti-082:${lines[1]}`, 120, false], [`alloc:ti-083:${lines[2]}`, 50, true],
  ].sort());
  await assert.rejects(open().issueInvoice({ customerId: client.id, invoiceDate: "2026-09-20", customer: CUSTOMER, actor: "TEST", items: [{ billingItemId: lines[3], description: "x", quantity: 1, unitPrice: 80, amount: 80 }] }),
    (error: unknown) => error instanceof RuleError && error.code === "ALREADY_BILLED");

  // Collection: 081 was marked paid before IMS → collected; 082 open; payments not changed.
  const find = (id: string) => snap.taxInvoices!.find((i) => i.id === id)!;
  const c081 = invoiceCollection(snap, find("ti-081"));
  assert.deepEqual([c081.status, c081.paidUsd, c081.outstandingUsd], ["PAID", 132, 0]);
  assert.deepEqual([invoiceCollection(snap, find("ti-082")).status, invoiceCollection(snap, find("ti-082")).outstandingUsd], ["UNPAID", 132]);
  await assert.rejects(open().addInvoicePayment({ invoiceId: "ti-081", amount: 1, actor: "TEST" }), (error: unknown) => error instanceof RuleError && error.code === "OVERPAYMENT");
  await assert.rejects(open().voidInvoicePayment("ledger:led-081", "x", "TEST"), (error: unknown) => error instanceof RuleError && error.code === "NOT_FOUND");
  assert.equal(snap.invoicePayments!.length, 0); // nothing written for the old invoices
  // Totals, numbers, rates and customer snapshots as issued.
  assert.deepEqual(
    ["ti-081", "ti-082", "ti-083"].map((id) => [find(id).invoiceNumber, find(id).totalUsd, find(id).totalKhr, find(id).exchangeRate, find(id).customer.companyNameEn, find(id).status]),
    [["CIJDTI2026081", 132, 541200, 4100, "TEST Legacy Co., Ltd.", "ISSUED"], ["CIJDTI2026082", 132, 541200, 4100, "TEST Legacy Co., Ltd.", "ISSUED"], ["CIJDTI2026083", 55, 225500, 4100, "TEST Legacy Co., Ltd.", "CANCELLED"]],
  );
});

test("F. an empty 2026 database starts the real series at CIJDTI2026081, never at or below the paper series", async () => {
  const d1 = sqliteD1();
  const open = () => new Store(d1Persistence(d1, buildV5Seed));
  const persistence = d1Persistence(d1, buildV5Seed);
  await open().getSnapshot();
  const db = (await persistence.read())!;
  db.exchangeRates.push({ id: "nbc", currencyPair: "USD/KHR", rate: 4100, source: "NBC", effectiveDate: "2026-09-20", fetchedAt: "2026-09-20T03:00:00Z" });
  await persistence.write(db);
  const customer = await open().saveCustomer({ name: "Real Co", companyNameEn: "Real Co., Ltd.", actor: "Accounting" });
  const issued = await open().issueInvoice({ customerId: customer.id, invoiceDate: "2026-09-20", customer: { ...CUSTOMER, companyNameEn: "Real Co., Ltd." }, actor: "Accounting", items: [{ description: "x", quantity: 1, unitPrice: 1 }] });
  assert.equal(issued.invoiceNumber, "CIJDTI2026081");
});
