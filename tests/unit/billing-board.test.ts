import assert from "node:assert/strict";
import { test } from "node:test";

import { archiveBoard, billingBoard, readinessOf, toBoardItem } from "../../src/lib/billing-v2/board.ts";
import { markProjectsBilled } from "../../src/lib/billing-v2/mark-billed.ts";
import { serviceKeyFromName, serviceOptions } from "../../src/lib/billing-v2/services.ts";
import type { BillingItem, Project, Snapshot } from "../../src/lib/types.ts";

const CLIENT = { id: "c1", name: "Ringer Hut", active: true, createdAt: "2026-09-01" };

function project(id: string, overrides: Partial<Project> = {}): Project {
  return {
    id,
    clientId: "c1",
    name: id,
    date: "2026-09-01",
    createdAt: "2026-09-01",
    createdBy: "Hiroki",
    updatedAt: "2026-09-01",
    updatedBy: "Hiroki",
    deletedAt: null,
    billingReadiness: "AUTO",
    ...overrides,
  } as Project;
}

function item(id: string, projectId: string, overrides: Partial<BillingItem> = {}): BillingItem {
  return {
    id,
    projectId,
    description: "Design",
    type: "DESIGN",
    serviceType: "DESIGN",
    quantity: 1,
    unitPrice: 0,
    amount: 25,
    customAmount: false,
    productionStatus: "IN_PROGRESS",
    billingStatus: "NOT_READY",
    invoiceId: null,
    printCost: null,
    priceReviewStatus: "NOT_REQUIRED",
    createdAt: `2026-09-01T00:00:0${id.length}Z`,
    createdBy: "Hiroki",
    deletedAt: null,
    ...overrides,
  } as BillingItem;
}

function snapshot(projects: Project[], items: BillingItem[], extra: Partial<Snapshot> = {}): Snapshot {
  return {
    clients: [CLIENT, { id: "d", name: "DAISHIN", active: true, createdAt: "" }],
    projects,
    billingItems: items,
    invoices: [],
    invoiceItems: [],
    users: [],
    serviceTypes: [],
    exchangeRate: null,
    exchangeRateLastCheckedAt: null,
    mode: "local",
    scope: { production: true, billing: true, payment: true },
    ...extra,
  } as Snapshot;
}

test("a new project with nothing on it waits in progress", () => {
  const board = billingBoard(snapshot([project("p1")], []));
  assert.equal(board.readyCount, 0);
  assert.equal(board.inProgress[0].projects[0].blocker, "NO_ITEMS");
});

test("a pending price keeps a project in progress even when it was marked ready", () => {
  const board = billingBoard(
    snapshot([project("p1", { billingReadiness: "READY" })], [item("i1", "p1", { amount: null })]),
  );
  assert.equal(board.readyCount, 0);
  const held = board.inProgress[0].projects[0];
  assert.equal(held.blocker, "PRICE");
  assert.equal(held.pricePendingCount, 1);
});

test("$0 is a price, not a pending one", () => {
  const board = billingBoard(
    snapshot([project("p1", { billingReadiness: "READY" })], [item("i1", "p1", { amount: 0 })]),
  );
  assert.equal(board.readyCount, 1);
  assert.equal(board.ready[0].projects[0].pricePendingCount, 0);
});

test("a project marked ready stays ready while its production is unfinished", () => {
  const board = billingBoard(snapshot([project("p1", { billingReadiness: "READY" })], [item("i1", "p1")]));
  assert.equal(board.readyCount, 1);
  assert.equal(board.readyTotal, 25);
});

test("a project moved to in progress stays there even when every line is finished", () => {
  const done = item("i1", "p1", { productionStatus: "COMPLETED", billingStatus: "READY_TO_INVOICE" });
  const board = billingBoard(snapshot([project("p1", { billingReadiness: "IN_PROGRESS" })], [done]));
  assert.equal(board.inProgress[0].projects[0].blocker, "STATUS");
});

test("totals, print cost and the recommendation come from one place", () => {
  const print = item("i2", "p1", {
    description: "Print x900",
    type: "PRINT",
    serviceType: "PRINTING",
    quantity: 900,
    printCost: 30,
    amount: 45,
  });
  const board = billingBoard(
    snapshot([project("p1", { billingReadiness: "READY" })], [item("i1", "p1", { amount: 10 }), print]),
  );
  const ready = board.ready[0].projects[0];
  assert.equal(ready.total, 55);
  assert.equal(ready.costTotal, 30);
  assert.equal(board.printCostOutstanding, 30);
  const line = ready.items.find((entry) => entry.item.id === "i2")!;
  // $30 cost, +50% markup.
  assert.equal(line.recommended, 45);
  assert.equal(line.margin, 0.5);
  assert.equal(line.manual, false);
});

test("a final price that differs from the recommendation is marked as set by hand", () => {
  const entry = toBoardItem(item("i1", "p1", { type: "PRINT", serviceType: "PRINTING", printCost: 60, amount: 90 }));
  assert.equal(entry.recommended, 84);
  assert.equal(entry.manual, true);
});

test("DAISHIN and imported history never reach these screens", () => {
  const board = billingBoard(
    snapshot(
      [project("p1", { clientId: "d" }), project("p2", { createdBy: "import" })],
      [item("i1", "p1"), item("i2", "p2")],
    ),
  );
  assert.equal(board.ready.length + board.inProgress.length, 0);
});

test("billed work moves to Archive with its billing date", () => {
  const billed = item("i1", "p1", { billingStatus: "INVOICED", invoiceId: "inv1" });
  const groups = archiveBoard(
    snapshot([project("p1")], [billed], {
      invoices: [{ id: "inv1", invoiceDate: "2026-09-11", createdAt: "2026-09-11T02:00:00Z" }] as Snapshot["invoices"],
    }),
  );
  assert.equal(groups[0].projects[0].billedAt, "2026-09-11");
  assert.equal(groups[0].total, 25);
  assert.equal(billingBoard(snapshot([project("p1")], [billed])).inProgressCount, 0);
});

test("readiness reads lines in the order a person would", () => {
  assert.equal(readinessOf("READY", []).blocker, "NO_ITEMS");
  assert.equal(readinessOf("IN_PROGRESS", [toBoardItem(item("i1", "p1", { amount: null }))]).blocker, "PRICE");
});

test("adding Visa from the picker turns the planned built-in on", () => {
  const keys = serviceOptions([{ key: "VISA", name: "Visa", active: true }]).map((service) => service.key);
  assert.ok(keys.includes("VISA"));
  assert.ok(!serviceOptions([]).some((service) => service.key === "VISA"));
});

test("a service name without Latin letters still gets a valid key", () => {
  assert.equal(serviceKeyFromName("Visa"), "VISA");
  assert.equal(serviceKeyFromName("Photo shoot"), "PHOTO_SHOOT");
  assert.match(serviceKeyFromName("翻訳", 1_700_000_000_000), /^SERVICE_[A-Z0-9]+$/);
});

function fakeRepo(data: Snapshot) {
  const calls: string[] = [];
  return {
    calls,
    getSnapshot: async () => data,
    setProjectBillingReadiness: async (id: string, readiness: string) => {
      calls.push(`readiness:${id}:${readiness}`);
      return data.projects.find((candidate) => candidate.id === id)!;
    },
    createInvoice: async (input: { billingItemIds: string[] }) => {
      calls.push(`invoice:${input.billingItemIds.join(",")}`);
      return {} as never;
    },
  };
}

test("marking billed re-applies a by-hand ready decision, then bills each project once", async () => {
  const data = snapshot(
    [project("p1", { billingReadiness: "READY" })],
    [item("i1", "p1"), item("i22", "p1", { amount: 5 })],
  );
  const repo = fakeRepo(data);
  const result = await markProjectsBilled(repo as never, { projectIds: ["p1"] });
  assert.deepEqual(repo.calls, ["readiness:p1:READY", "invoice:i1,i22"]);
  assert.equal(result.total, 30);
});

test("marking billed refuses anything the screen would not show as ready", async () => {
  const data = snapshot(
    [project("p1", { billingReadiness: "READY" }), project("p2")],
    [item("i1", "p1", { amount: null }), item("i2", "p2")],
  );
  await assert.rejects(markProjectsBilled(fakeRepo(data) as never, { projectIds: ["p1"] }), { code: "PRICE_REQUIRED" });
  const repo = fakeRepo(data);
  await assert.rejects(markProjectsBilled(repo as never, { projectIds: ["p2"] }), { code: "NOT_READY" });
  assert.deepEqual(repo.calls, []);
});
