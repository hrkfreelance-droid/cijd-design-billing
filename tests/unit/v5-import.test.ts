import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { archiveBoard, billingBoard } from "../../src/lib/billing-v2/board.ts";
import { chunkCollection, d1Persistence } from "../../src/lib/billing-v5/d1-persistence.ts";
import { buildV5Seed, setV5Env } from "../../src/lib/billing-v5/repository.ts";
import { planV3Import } from "../../src/lib/billing-v5/v3-import.ts";
import { Store } from "../../src/lib/data/store.ts";
import type { Snapshot } from "../../src/lib/types.ts";
import { parseArgs, run, v3Reader } from "../../scripts/v5-import/v3-to-v5.ts";
import { sqliteD1 } from "./d1-sqlite.ts";

import { fixture, T } from "../fixtures/v3-rows.ts";

test("plan: prices, quantities, costs, memos and statuses are copied exactly; nothing recalculated", () => {
  const { collections, summary, issues } = planV3Import(fixture());
  const line = (id: string) => collections.billingItems.find((item) => item.id === id)!;
  assert.deepEqual(
    { a: line("l-manual").amount, u: line("l-manual").unitPrice, q: line("l-manual").quantity, c: line("l-manual").printCost, m: line("l-manual").customAmount },
    { a: 305, u: 1.79, q: 170, c: 200, m: true },
  );
  assert.equal(line("l-oldrule").amount, 80); // the new rule would say $56 (40 × 1.4); not applied
  assert.equal(line("l-oldrule").markupOverride, 35);
  for (const item of collections.billingItems) assert.equal("finalMode" in item, false);
  assert.equal(collections.projects.find((p) => p.id === "p-ready")!.note, "Deliver Friday\nKhmer name on invoice");
  assert.equal(collections.projects.find((p) => p.id === "p-ready")!.depositAmount, 500);
  assert.equal(collections.projects.find((p) => p.id === "p-deleted")!.deletedAt, T);
  assert.equal(summary.counts.clients, 2);
  assert.equal(summary.counts.projects, 4);
  assert.equal(summary.activeProjects, 3);
  assert.equal(summary.counts.billingItems, 6);
  assert.equal(summary.activeLines, 5);
  assert.equal(summary.finalCents, 30500 + 8000 + 61000 + 15000);
  assert.deepEqual(summary.billingStatus, { NOT_READY: 1, PAID: 1, READY_TO_INVOICE: 3 });
  assert.deepEqual(issues, []);
});

test("plan: unsafe records are reported, not changed", () => {
  const rows = fixture();
  rows.billing_items.push({ ...rows.billing_items[2], id: "l-orphan", project_id: "nope" });
  rows.billing_items.push({ ...rows.billing_items[2], id: "l-nan", amount: "abc" });
  rows.billing_items.push({ ...rows.billing_items[2] }); // duplicate id
  const { issues, collections } = planV3Import(rows);
  const codes = issues.map((issue) => `${issue.severity}:${issue.code}:${issue.id}`);
  assert.ok(codes.includes("WARNING:ORPHAN_LINE:l-orphan"));
  assert.ok(codes.includes("BLOCKING:INVALID_NUMBER:l-nan"));
  assert.ok(codes.includes("BLOCKING:DUPLICATE_ID:l-design"));
  assert.equal(collections.billingItems.find((item) => item.id === "l-orphan")!.projectId, "nope");
});

function v5Env() {
  const d1 = sqliteD1();
  process.env.CIJD_V5_MODE = "1";
  setV5Env({ V5_DB: d1, V5_IMPORT_TOKEN: "secret-token" });
  return d1;
}

/** Routes the CLI's HTTP calls into the real Next route handler. */
async function handlerFetch(): Promise<typeof fetch> {
  const route = await import("../../src/lib/billing-v5/import-endpoint.ts");
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(String(input), init);
    return request.method === "POST" ? route.importPOST(request) : route.importGET(request);
  }) as typeof fetch;
}

async function writeDump() {
  const dir = mkdtempSync(path.join(tmpdir(), "v5-import-"));
  const file = path.join(dir, "v3.json");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(file, JSON.stringify(fixture()));
  return { dir, file };
}

test("import → V5 shows the same Billing and Archive as V3, prices untouched, verify passes", async () => {
  const d1 = v5Env();
  const fetcher = await handlerFetch();
  const { dir, file } = await writeDump();
  const logs: string[] = [];
  const options = { ...parseArgs(["--source-file", file, "--target", "https://cijd-design-billing-v5-preview.example.workers.dev", "--commit"]), out: path.join(dir, "out") };
  const result = await run(options, { V5_IMPORT_TOKEN: "secret-token" }, fetcher, (line) => logs.push(line));
  assert.equal(result.passed, true);
  const report = logs.join("\n");
  assert.match(report, /V3 CLIENT COUNT: 2\nV5 IMPORTED CLIENT COUNT: 2/);
  assert.match(report, /V3 LINE COUNT: 6 \(active 5\)\nV5 IMPORTED LINE COUNT: 6 \(active 5\)/);
  assert.match(report, /PRICE PRESERVATION: PASS/);
  assert.match(report, /MEMO PRESERVATION: PASS/);
  assert.match(report, /STATUS PRESERVATION: PASS/);

  // What V5's screens compute equals what V3's compute from the same rows.
  const v3 = planV3Import(fixture()).collections;
  const v3Snapshot = { ...v3, projects: v3.projects.filter((p) => !p.deletedAt), billingItems: v3.billingItems.filter((i) => !i.deletedAt) } as unknown as Snapshot;
  const v5Snapshot = await new Store(d1Persistence(d1, buildV5Seed)).getSnapshot();
  const shape = (s: Snapshot) => ({
    billing: billingBoard(s).ready.concat(billingBoard(s).inProgress).flatMap((g) => g.projects.map((p) => [p.id, p.total, p.note, p.balance, p.items.map((e) => [e.item.id, e.amount, e.manual])])),
    archive: archiveBoard(s).flatMap((g) => g.projects.map((p) => [p.id, p.total])),
  });
  assert.deepEqual(shape(v5Snapshot), shape(v3Snapshot));
  const ready = billingBoard(v5Snapshot).ready[0].projects[0];
  assert.equal(ready.total, 995);
  assert.equal(ready.balance.remaining, 495); // $995 − $500 deposit
  assert.equal(ready.items.find((e) => e.item.id === "l-manual")!.manual, true);

  // Verify later, independently.
  const verify = await run({ ...options, commit: false, verify: true }, { V5_IMPORT_TOKEN: "secret-token" }, fetcher, () => {});
  assert.equal(verify.passed, true);

  // A second import is refused: V5 is no longer empty.
  await assert.rejects(run(options, { V5_IMPORT_TOKEN: "secret-token" }, fetcher, () => {}), /V5_NOT_EMPTY/);
});

test("import endpoint refuses a wrong token and the V3/V4 Workers as target", async () => {
  v5Env();
  const fetcher = await handlerFetch();
  const { dir, file } = await writeDump();
  const base = { ...parseArgs(["--source-file", file, "--commit"]), out: path.join(dir, "out") };
  await assert.rejects(run({ ...base, target: "https://v5.example" }, { V5_IMPORT_TOKEN: "wrong" }, fetcher, () => {}), /UNAUTHENTICATED/);
  await assert.rejects(run({ ...base, target: "https://cijd-design-billing-preview.hrk-freelance.workers.dev" }, { V5_IMPORT_TOKEN: "secret-token" }, fetcher, () => {}), /not the V5 Worker/);
  await assert.rejects(run({ ...base, target: "https://cijd-design-billing-v4-preview.hrk-freelance.workers.dev" }, { V5_IMPORT_TOKEN: "secret-token" }, fetcher, () => {}), /not the V5 Worker/);
});

test("blocking issues stop the import before anything is sent", async () => {
  v5Env();
  const { dir } = await writeDump();
  const rows = fixture();
  rows.billing_items[0].amount = "abc";
  const { writeFileSync } = await import("node:fs");
  const bad = path.join(dir, "bad.json");
  writeFileSync(bad, JSON.stringify(rows));
  let calls = 0;
  const counting = (async () => {
    calls += 1;
    return new Response("{}");
  }) as unknown as typeof fetch;
  await assert.rejects(
    run({ ...parseArgs(["--source-file", bad, "--target", "https://v5.example", "--commit"]), out: path.join(dir, "o") }, { V5_IMPORT_TOKEN: "x" }, counting, () => {}),
    /blocking issue/,
  );
  assert.equal(calls, 0);
});

test("V3 reader: GET only, every page, and a short read is an error", async () => {
  const methods: string[] = [];
  const rows = Array.from({ length: 1200 }, (_, i) => ({ id: `c${String(i).padStart(4, "0")}`, name: `Client ${i}`, active: true, created_at: T }));
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    methods.push(init?.method ?? "GET");
    const url = new URL(String(input));
    const offset = Number(url.searchParams.get("offset"));
    const limit = Number(url.searchParams.get("limit"));
    const page = rows.slice(offset, offset + limit);
    return new Response(JSON.stringify(page), { headers: { "content-range": `${offset}-${offset + page.length - 1}/${rows.length}` } });
  }) as typeof fetch;
  const read = v3Reader("https://example.supabase.co", "key", fake);
  const result = await read("clients");
  assert.equal(result.rows.length, 1200);
  assert.deepEqual([...new Set(methods)], ["GET"]);

  const short = (async () => new Response(JSON.stringify(rows.slice(0, 10)), { headers: { "content-range": "0-9/1200" } })) as unknown as typeof fetch;
  await assert.rejects(v3Reader("https://example.supabase.co", "key", short)("clients"), /reports 1200/);
});

test("large collections are stored in chunks and read back whole; shrinking removes stale chunks", async () => {
  const d1 = sqliteD1();
  const persistence = d1Persistence(d1, buildV5Seed, { chunkBytes: 2_000 });
  const db = (await persistence.read())!;
  db.clients = Array.from({ length: 300 }, (_, i) => ({ id: `c${i}`, name: `ក្រុមហ៊ុន ${i}`, active: true, createdAt: T }));
  await persistence.write(db);
  const rowsAfter = (d1.raw.prepare("SELECT count(*) AS n FROM v5_state WHERE collection LIKE 'clients%'").get() as { n: number }).n;
  assert.ok(rowsAfter > 5);
  const again = d1Persistence(d1, buildV5Seed, { chunkBytes: 2_000 });
  const read = (await again.read())!;
  assert.deepEqual(read.clients, db.clients);
  read.clients = read.clients.slice(0, 3);
  await again.write(read);
  assert.equal((d1.raw.prepare("SELECT count(*) AS n FROM v5_state WHERE collection LIKE 'clients%'").get() as { n: number }).n, 1);
  assert.equal((await d1Persistence(d1, buildV5Seed).read())!.clients.length, 3);
  assert.equal(chunkCollection([], 100).length, 1);
});
