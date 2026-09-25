import assert from "node:assert/strict";
import { test } from "node:test";

import { toBoardProject } from "../../src/lib/billing-v2/board.ts";
import { RuleError } from "../../src/lib/data/repository.ts";
import { buildSeed } from "../../src/lib/data/seed.ts";
import { Store, type Persistence } from "../../src/lib/data/store.ts";

type Database = NonNullable<Awaited<ReturnType<Persistence["read"]>>>;

/**
 * A persistence that keeps a JSON copy, so every `reopen()` reads the same
 * bytes a reload would — nothing survives in memory between Stores.
 */
function memory(initial: Database = buildSeed()) {
  let saved = JSON.stringify(initial);
  const persistence: Persistence = {
    async read() {
      return JSON.parse(saved) as Database;
    },
    async write(db) {
      saved = JSON.stringify(db);
    },
  };
  return {
    reopen: () => new Store(persistence),
    raw: () => JSON.parse(saved) as Database,
    edit(change: (db: Database) => void) {
      const db = JSON.parse(saved) as Database;
      change(db);
      saved = JSON.stringify(db);
    },
  };
}

async function setup() {
  const mem = memory();
  const store = mem.reopen();
  const project = await store.createProject({ clientId: "cl_ringer_hut", name: "Deposit test" });
  const print = await store.createBillingItem({
    projectId: project.id,
    description: "Flyers",
    type: "PRINT",
    serviceType: "PRINTING",
    quantity: 180,
    printCost: 40,
  });
  return { mem, project, print };
}

async function rejectsWith(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => error instanceof RuleError && error.code === code);
}

test("a new print line is recommended with the markup rule", async () => {
  const { print } = await setup();
  assert.equal(print.amount, 60); // $40 × 1.5
  assert.equal(print.suggestedAmount, 60);
});

test("deposit: none by default, then partial, equal, over — each survives a reload", async () => {
  const { mem, project } = await setup();
  const snapshot = async () => {
    const snap = await mem.reopen().getSnapshot();
    const stored = snap.projects.find((entry) => entry.id === project.id)!;
    const items = snap.billingItems.filter((item) => item.projectId === project.id);
    return { stored, board: toBoardProject(stored, items, snap) };
  };

  let { stored, board } = await snapshot();
  assert.equal(stored.depositAmount ?? null, null);
  assert.deepEqual(board.balance, { finalTotal: 60, deposit: 0, remaining: 60, overpaid: 0, settled: false });

  for (const [deposit, remaining, overpaid] of [
    [20, 40, 0],
    [60, 0, 0],
    [75, 0, 15],
  ] as const) {
    await mem.reopen().setProjectDeposit(project.id, deposit);
    ({ stored, board } = await snapshot());
    assert.equal(stored.depositAmount, deposit);
    assert.equal(board.balance.remaining, remaining, `deposit ${deposit}`);
    assert.equal(board.balance.overpaid, overpaid, `deposit ${deposit}`);
    // A deposit is payment information only.
    assert.equal(board.total, 60);
    assert.equal(board.items[0].amount, 60);
    assert.equal(board.items[0].recommended, 60);
  }

  await mem.reopen().setProjectDeposit(project.id, null);
  ({ stored } = await snapshot());
  assert.equal(stored.depositAmount, null);
});

test("a negative deposit is refused", async () => {
  const { mem, project } = await setup();
  await rejectsWith(mem.reopen().setProjectDeposit(project.id, -1), "INVALID");
});

test("projects saved before deposits existed read as no deposit", async () => {
  const mem = memory();
  const snap = await mem.reopen().getSnapshot();
  const legacy = snap.projects.find((entry) => entry.id === "pj_rh_kids_promotion")!;
  assert.equal("depositAmount" in (mem.raw().projects[0] as object), false);
  const board = toBoardProject(legacy, snap.billingItems.filter((item) => item.projectId === legacy.id), snap);
  assert.equal(board.balance.deposit, 0);
  assert.equal(board.balance.remaining, board.total);
});

test("Final Unit Price is stored with its total and survives a reload", async () => {
  const { mem, print } = await setup();
  await mem.reopen().overrideBillingUnitPrice(print.id, 4.3, 774);
  const stored = (await mem.reopen().getSnapshot()).billingItems.find((item) => item.id === print.id)!;
  assert.equal(stored.unitPrice, 4.3);
  assert.equal(stored.amount, 774);
  assert.equal(stored.customAmount, true);
  // The recommendation stays the reference it was.
  assert.equal(stored.suggestedAmount, 60);
});

test("a typed total stores its unit price to the cent", async () => {
  const mem = memory();
  const store = mem.reopen();
  const project = await store.createProject({ clientId: "cl_ringer_hut", name: "Thirds" });
  const line = await store.createBillingItem({
    projectId: project.id,
    description: "Design",
    type: "DESIGN",
    serviceType: "DESIGN",
    quantity: 3,
    unitPrice: 10,
  });
  const saved = await mem.reopen().overrideBillingUnitPrice(line.id, 18.33, 55);
  assert.equal(saved.amount, 55);
  assert.equal(saved.unitPrice, 18.33);
});

test("a unit price that does not belong to the total is refused", async () => {
  const { mem, print } = await setup();
  await rejectsWith(mem.reopen().overrideBillingUnitPrice(print.id, 4.3, 800), "INVALID");
});

for (const status of ["INVOICED", "PAID"] as const) {
  test(`an ${status.toLowerCase()} line stays locked: no price, unit price or deposit change`, async () => {
    const { mem, project, print } = await setup();
    mem.edit((db) => {
      const item = db.billingItems.find((entry) => entry.id === print.id)!;
      item.billingStatus = status;
      item.invoiceId = "inv_test";
    });
    const before = JSON.stringify(mem.raw().billingItems.find((entry) => entry.id === print.id));
    await rejectsWith(mem.reopen().overrideBillingPrice(print.id, 99), "ITEM_LOCKED");
    await rejectsWith(mem.reopen().overrideBillingUnitPrice(print.id, 4.3, 774), "ITEM_LOCKED");
    await rejectsWith(mem.reopen().setProjectDeposit(project.id, 10), "PROJECT_LOCKED");
    assert.equal(JSON.stringify(mem.raw().billingItems.find((entry) => entry.id === print.id)), before);
    assert.equal(mem.raw().projects.find((entry) => entry.id === project.id)!.depositAmount ?? null, null);
  });
}

test("imported history stays read-only", async () => {
  const { mem, print } = await setup();
  mem.edit((db) => {
    db.billingItems.find((entry) => entry.id === print.id)!.createdBy = "import";
  });
  await rejectsWith(mem.reopen().overrideBillingUnitPrice(print.id, 4.3, 774), "HISTORY_READ_ONLY");
});

test("existing stored prices are never rewritten by the new rule", async () => {
  // Priced under the old gross-margin rule: $40 cost → $80, unit $0.44.
  const mem = memory();
  mem.edit((db) => {
    db.billingItems.push({
      ...db.billingItems[0],
      id: "bi_old_rule",
      type: "PRINT",
      serviceType: "PRINTING",
      quantity: 180,
      unitPrice: 0.44,
      amount: 80,
      customAmount: false,
      printCost: 40,
      suggestedAmount: 80,
      suggestedUnitPrice: 0.44,
      priceReviewStatus: "CONFIRMED",
    });
  });
  const before = JSON.stringify(mem.raw());
  const snap = await mem.reopen().getSnapshot();
  const item = snap.billingItems.find((entry) => entry.id === "bi_old_rule")!;
  assert.equal(item.amount, 80);
  assert.equal(item.suggestedAmount, 80);
  // Reading (and re-reading) the ledger writes nothing.
  await mem.reopen().getSnapshot();
  assert.equal(JSON.stringify(mem.raw()), before);
});
