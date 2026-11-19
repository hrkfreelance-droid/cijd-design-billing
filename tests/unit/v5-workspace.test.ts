import assert from "node:assert/strict";
import { test } from "node:test";
import { missingHistory } from "../../scripts/v5-import/legacy-history.ts";
import { buildV5Seed } from "../../src/lib/billing-v5/repository.ts";
import { buildProjectViews, normalizeSearch, priceHistory, projectMatches, similarProjects } from "../../src/lib/billing-v5/project-view.ts";
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
