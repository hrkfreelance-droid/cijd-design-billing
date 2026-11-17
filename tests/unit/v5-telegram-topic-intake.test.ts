import assert from "node:assert/strict";
import { test } from "node:test";

import { d1Persistence } from "../../src/lib/billing-v5/d1-persistence.ts";
import { buildV5Seed } from "../../src/lib/billing-v5/repository.ts";
import {
  parseTelegramTopicInput,
  phnomPenhDate,
  resolveIntakeClient,
  sameSecret,
  topicMarker,
} from "../../src/lib/billing-v5/telegram-topic-intake.ts";
import { RuleError } from "../../src/lib/data/repository.ts";
import { Store } from "../../src/lib/data/store.ts";
import { sqliteD1 } from "./d1-sqlite.ts";

const CUSTOMER = "Ringerhut(Cambodia) CO.,Ltd";
const CHAT = "-1001234567890";

function v5() {
  const d1 = sqliteD1();
  return { d1, open: () => new Store(d1Persistence(d1, buildV5Seed)) };
}

async function setup() {
  const env = v5();
  const rh = await env.open().createClient({ name: CUSTOMER });
  const other = await env.open().createClient({ name: "Other Test Customer" });
  // existing billed work for the same customer must stay untouched
  const old = await env.open().createProject({ clientId: rh.id, name: "TEST Existing Menu" });
  await env.open().createBillingItem({
    projectId: old.id, description: "Design", type: "DESIGN", serviceType: "DESIGN", quantity: 1, unitPrice: 50,
  } as never);
  return { ...env, rh, other, old };
}

const input = (overrides: Record<string, unknown> = {}) =>
  parseTelegramTopicInput({
    customerName: CUSTOMER, chatId: CHAT, topicId: 501, topicName: "TEST RH Winter Menu",
    createdAt: "2026-11-17T18:30:00Z", link: "https://t.me/c/1234567890/501", ...overrides,
  });

async function rejectsWith(fn: () => unknown, code: string) {
  await assert.rejects(async () => fn(), (e: unknown) => e instanceof RuleError && e.code === code);
}

test("a new topic becomes one In Progress project with no amount", async () => {
  const { open, rh, old } = await setup();
  const before = await open().getSnapshot();
  const result = await open().registerTelegramTopic(input());
  assert.equal(result.status, "created");
  const snap = await open().getSnapshot();
  const project = snap.projects.find((p) => p.id === result.project.id)!;
  assert.equal(project.clientId, rh.id);
  assert.equal(project.name, "TEST RH Winter Menu");
  assert.equal(project.date, "2026-11-18"); // 18:30Z = 01:30 next day in Phnom Penh
  assert.equal(project.createdBy, "PIMO (Telegram)");
  assert.ok(project.note!.includes("https://t.me/c/1234567890/501"));
  assert.ok(project.note!.includes(topicMarker(CHAT, 501)));
  assert.equal(snap.billingItems.filter((i) => i.projectId === project.id).length, 0); // no amount
  // nothing else changed
  assert.deepEqual(snap.billingItems, before.billingItems);
  assert.deepEqual(snap.invoices, before.invoices);
  assert.deepEqual(snap.taxInvoices, before.taxInvoices);
  assert.deepEqual(snap.projects.find((p) => p.id === old.id), before.projects.find((p) => p.id === old.id));
  assert.equal(snap.projects.length, before.projects.length + 1);
});

test("the same topic is never registered twice, even after a rename", async () => {
  const { open } = await setup();
  const first = await open().registerTelegramTopic(input());
  const again = await open().registerTelegramTopic(input());
  const renamed = await open().registerTelegramTopic(input({ topicName: "TEST RH Winter Menu v2" }));
  assert.equal(again.status, "exists");
  assert.equal(renamed.status, "exists");
  assert.equal(renamed.project.id, first.project.id);
  assert.equal(renamed.project.name, "TEST RH Winter Menu"); // rename does not edit the project
  const snap = await open().getSnapshot();
  assert.equal(snap.projects.filter((p) => (p.note ?? "").includes(topicMarker(CHAT, 501))).length, 1);
});

test("a same-name project of the customer is reported, not duplicated", async () => {
  const { open } = await setup();
  const result = await open().registerTelegramTopic(input({ topicId: 777, topicName: "test existing menu" }));
  assert.equal(result.status, "name_exists");
  assert.equal(result.project.name, "TEST Existing Menu");
  assert.equal((await open().getSnapshot()).projects.length, 1);
});

test("a deleted linked project is not recreated", async () => {
  const { open } = await setup();
  const first = await open().registerTelegramTopic(input());
  await open().deleteUninvoicedV5Project(first.project.id, "Tester");
  const again = await open().registerTelegramTopic(input());
  assert.equal(again.status, "deleted");
});

test("only the allowed customer, and only a unique exact match", async () => {
  await rejectsWith(() => input({ customerName: "Other Test Customer" }), "CUSTOMER_NOT_ALLOWED");
  const { open } = v5();
  await rejectsWith(() => open().registerTelegramTopic(input()), "CUSTOMER_NOT_FOUND");
  // a seed client and a tax-customer record both named exactly like the customer
  const db = {
    clients: [
      { id: "c-seed", name: CUSTOMER, active: true },
      { id: "c-tax", name: "RH (tax)", active: true },
    ],
    customers: [{ id: "c-tax", companyNameEn: CUSTOMER, active: true }],
    projects: [],
  };
  await rejectsWith(() => resolveIntakeClient(db, CUSTOMER), "CUSTOMER_AMBIGUOUS");
  assert.equal(resolveIntakeClient({ ...db, clients: [db.clients[1]] }, CUSTOMER), "c-tax");
});

test("input validation", async () => {
  await rejectsWith(() => input({ chatId: "abc" }), "INVALID");
  await rejectsWith(() => input({ topicId: 1 }), "INVALID"); // General topic
  await rejectsWith(() => input({ topicName: "  " }), "INVALID");
  await rejectsWith(() => input({ createdAt: "yesterday" }), "INVALID");
  await rejectsWith(() => input({ link: "https://evil.example/x" }), "INVALID");
});

test("helpers", () => {
  assert.equal(phnomPenhDate("2026-11-17T16:59:59Z"), "2026-11-17");
  assert.equal(phnomPenhDate("2026-11-17T17:00:00Z"), "2026-11-18");
  assert.equal(sameSecret("abc", "abc"), true);
  assert.equal(sameSecret("abd", "abc"), false);
  assert.equal(sameSecret("", ""), false);
});
