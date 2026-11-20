import assert from "node:assert/strict";
import { test } from "node:test";
import { missingHistory } from "../../scripts/v5-import/legacy-history.ts";
import { billingBoard } from "../../src/lib/billing-v2/board.ts";
import { buildV5Seed } from "../../src/lib/billing-v5/repository.ts";
import { buildProjectViews, designProjects, normalizeSearch, priceHistory, projectMatches, similarProjects } from "../../src/lib/billing-v5/project-view.ts";
import { planV3Import } from "../../src/lib/billing-v5/v3-import.ts";
import type { Snapshot } from "../../src/lib/types.ts";
import { archiveItem, workspaceFixture } from "../fixtures/v5-workspace-history.ts";

test("archives in V5 and missing V3 projects share the same read-only view and preserve booked prices", () => {
  const plan = planV3Import(workspaceFixture());
  const alreadyInV5 = new Set(["p-older-billed", "p-ready", "p-deleted"]);
  const { rows, counts } = missingHistory(plan, alreadyInV5, new Set(["l-older-billed"]));
  assert.deepEqual(rows.map(({ project }) => project.id), ["p-billed"]);
  assert.equal(counts.missingLinesOnExistingProjects, 3);
  assert.equal(counts.liveOnlyInV3, 1);
  assert.equal(rows[0].items[0].printCost, 120000000);
  assert.equal(rows[0].payments[0].paidAt, "2026-09-02");
  assert.equal(rows[0].invoices[0].invoiceNumber, "EXAMPLE-ARCHIVE-01");
  const snapshot: Snapshot = {
    ...buildV5Seed(), ...plan.collections, mode: "local", scope: { billing: true, production: true, payment: true },
    exchangeRate: null, exchangeRateLastCheckedAt: null, legacyProjects: [...rows, {
      ...rows[0], project: { ...rows[0].project, id: "p-older-billed" },
    }],
    projects: plan.collections.projects.filter(({ id }) => alreadyInV5.has(id)),
    billingItems: plan.collections.billingItems.filter(({ projectId }) => alreadyInV5.has(projectId)),
  };
  const views = buildProjectViews(snapshot);
  const old = views.find(({ project }) => project.id === "p-billed")!;
  assert.equal(views.filter(({ project }) => project.id === "p-older-billed").length, 1);
  assert.equal(views.some(({ project }) => project.id === "p-deleted"), false);
  assert.equal(old.status, "completed");
  assert.equal(old.readOnly, true);
  assert.equal(old.canIssue, false);
  assert.equal(old.payments[0].amount, 150);
  assert.deepEqual(old.kinds, ["print", "design"]);
  assert.ok(projectMatches(old, "  ＡＲＣＨＩＶＥ   EXAMPLE-ARCHIVE-01  "));
  assert.ok(projectMatches(old, "Brochure artwork"));
  assert.deepEqual(similarProjects(old, views).map(({ project }) => project.id), ["p-older-billed"]);
  assert.deepEqual(priceHistory(views).filter(({ name }) => normalizeSearch(name) === normalizeSearch(archiveItem)).map(({ price }) => price), [1, 1.5]);
});

test("Design counts exclude issued, paid and handed-off work even with stale production flags", () => {
  const { collections } = planV3Import(workspaceFixture());
  const project = collections.projects.find(({ id }) => id === "p-progress")!;
  const item = collections.billingItems.find(({ projectId }) => projectId === project.id)!;
  const invoice = { ...collections.invoices[0], status: "ISSUED" as const };
  const paid = { ...invoice, id: "paid", status: "PAID" as const };
  const canceled = { ...invoice, id: "void", status: "VOID" as const };
  const taxCustomer = { companyNameEn: "Example Studio", companyNameKm: "", addressEn: "", addressKm: "", telephone: "", vatin: "" };
  const copy = (id: string, billingReadiness = project.billingReadiness) => ({ ...project, id, billingReadiness });
  const line = (projectId: string, overrides: Partial<typeof item> = {}) => ({ ...item, id: `item-${projectId}`, projectId, ...overrides });
  const snapshot: Snapshot = {
    ...buildV5Seed(), ...collections, mode: "local", scope: { billing: true, production: true, payment: true },
    exchangeRate: null, exchangeRateLastCheckedAt: null,
    projects: [copy("issued"), copy("paid"), copy("tax"), copy("void"), copy("ready", "READY"), copy("handoff", "ACCOUNTING"), copy("draft")],
    billingItems: [
      line("issued", { billingStatus: "INVOICED", invoiceId: invoice.id }),
      line("paid", { invoiceId: paid.id }), // Old line status never moved to PAID.
      line("tax"),
      line("void", { invoiceId: canceled.id }),
      line("ready", { amount: 50 }),
      line("handoff", { amount: 50 }),
    ],
    invoices: [invoice, paid, canceled],
    taxInvoices: [{
      id: "tax-invoice", invoiceNumber: "EXAMPLE-01", invoiceDate: "2026-09-01", issuedAt: project.createdAt,
      issuedBy: "Example accountant", status: "ISSUED", clientId: project.clientId, projectId: "", projectIds: ["tax"], ledgerInvoiceId: "",
      customer: taxCustomer, project: { name: "Example project", note: "" }, lines: [],
      vatApplicable: false, vatPercent: 0, subtotalUsd: 50, vatUsd: 0, totalUsd: 50,
      exchangeRate: 4100, exchangeRateSource: "MANUAL", exchangeRateEffectiveDate: null, totalKhr: 205000,
    }],
  };
  const views = buildProjectViews(snapshot);
  assert.deepEqual(views.map(({ project, status, collection }) => [project.id, status, collection]), [
    ["issued", "completed", "outstanding"],
    ["paid", "completed", "collected"],
    ["tax", "completed", "outstanding"],
    ["void", "progress", null],
    ["ready", "ready", null],
    ["handoff", "accounting", null],
    ["draft", "progress", null],
  ]);
  assert.equal(views[0].workComplete, false);
  assert.equal(views.find(({ status }) => status === "accounting")?.canIssue, true);
  const board = billingBoard(snapshot, designProjects(views));
  assert.equal(board.readyCount, 1);
  assert.equal(board.inProgressCount, 2);
  assert.equal(board.readyTotal, 50);
});
