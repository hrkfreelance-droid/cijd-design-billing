#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { unstable_dev } from "wrangler";

const root = path.resolve(import.meta.dirname, "..");
const config = path.join(root, "wrangler.jsonc");
const builtConfig = path.join(root, "dist/server/wrangler.json");
const wrangler = path.join(root, "node_modules/wrangler/bin/wrangler.js");
const configData = JSON.parse(await readFile(config, "utf8"));
const database = configData.d1_databases.find((binding) => binding.binding === "DB");
if (!database) throw new Error("wrangler.jsonc is missing the isolated DB binding");
await readFile(builtConfig, "utf8").catch(() => {
  throw new Error("Run npm run build:worker before the D1 integration test");
});

const persistTo = await mkdtemp(path.join(os.tmpdir(), "cijd-v4-d1-integration-"));
const localAccessToken = "v4-local-integration-token";
const localSessionSecret = "v4-local-integration-session-secret";
let worker;
let workerOrigin;

function command(args) {
  const result = spawnSync(process.execPath, [wrangler, ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      WRANGLER_LOG_PATH: path.join(persistTo, "wrangler-logs"),
      WRANGLER_SEND_METRICS: "false",
    },
  });
  if (result.status !== 0) {
    throw new Error([`Wrangler local command failed (${result.status})`, result.stdout, result.stderr].filter(Boolean).join("\n"));
  }
  return result.stdout;
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a local test port");
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function request(pathname, { method = "GET", body, cookie, redirect = "follow" } = {}) {
  const headers = new Headers();
  if (body !== undefined) headers.set("content-type", "application/json");
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(new URL(pathname, workerOrigin), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect,
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { response, body: parsed };
}

async function post(pathname, body, cookie) {
  return request(pathname, { method: "POST", body, cookie });
}

function unwrap(result, expectedStatus) {
  assert.equal(result.response.status, expectedStatus, JSON.stringify(result.body));
  return result.body;
}

try {
  command(["d1", "migrations", "apply", database.database_name, "--local", "--config", config, "--persist-to", persistTo]);
  const seedPath = path.join(persistTo, "seed-exchange-rate.sql");
  const today = new Date().toISOString().slice(0, 10);
  await writeFile(seedPath, `INSERT INTO exchange_rates (id, rate_scaled, source, effective_date, fetched_at) VALUES ('00000000-0000-4000-8000-000000000001', 40260000, 'NBC', '${today}', '${new Date().toISOString()}');\n`);
  command(["d1", "execute", database.database_name, "--local", "--config", config, "--persist-to", persistTo, "--file", seedPath]);

  worker = await unstable_dev(path.join(root, "dist/server/index.js"), {
    config: builtConfig,
    bundle: false,
    compatibilityDate: "2026-09-04",
    port: await freePort(),
    local: true,
    persistTo,
    vars: { V4_ACCESS_TOKEN: localAccessToken, V4_SESSION_SECRET: localSessionSecret },
    logLevel: "error",
    experimental: { disableDevRegistry: true },
  });
  workerOrigin = `http://${worker.address}:${worker.port}`;

  const unauthorized = await request("/api/v4/bootstrap");
  assert.equal(unauthorized.response.status, 401, "Worker must reject unauthenticated V4 API requests");
  const invalidAccess = (await request(`/access/${encodeURIComponent("wrong-local-token")}`, { redirect: "manual" })).response;
  assert.equal(invalidAccess.status, 401, "Worker must reject invalid access links");
  const access = (await request(`/access/${encodeURIComponent(localAccessToken)}`, { redirect: "manual" })).response;
  assert.equal(access.status, 302);
  const cookie = access.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie, "valid access link should create a session cookie");

  const customer = unwrap(await post("/api/v4/customers", {
    companyNameEn: "CIJD Local Test",
    companyNameKm: "អតិថិជនសាកល្បង",
    contactName: "Preview Test",
    addressEn: "Phnom Penh",
    addressKm: "ភ្នំពេញ",
    telephone: "+855 12 345 678",
    vatin: "TAX-LOCAL-01",
  }, cookie), 201);
  const project = unwrap(await post("/api/v4/projects", {
    customerId: customer.id,
    code: "V4-LOCAL-TEST",
    title: "D1 integration",
    depositUsd: 25,
  }, cookie), 201);

  const baseItem = {
    projectId: project.id,
    serviceType: "Design",
    description: "Brand identity",
    quantity: 1,
    unitCostUsd: 30,
    totalCostUsd: 30,
    markupOverridePercent: null,
    recommendedTotalUsd: 45,
    finalUnitUsd: 45,
    finalTotalUsd: 45,
    finalMode: "AUTO",
    readiness: "READY",
  };
  const firstItem = unwrap(await post("/api/v4/billing-items", baseItem, cookie), 201);
  const manualItem = unwrap(await post("/api/v4/billing-items", {
    ...baseItem,
    serviceType: "Manual",
    description: "Manual layout fee",
    quantity: 2,
    unitCostUsd: null,
    totalCostUsd: null,
    recommendedTotalUsd: null,
    finalUnitUsd: 100,
    finalTotalUsd: 200,
    finalMode: "UNIT",
  }, cookie), 201);
  assert.equal(firstItem.recommendedTotalUsd, 45);
  assert.equal(manualItem.finalTotalUsd, 200);
  const beforeDraft = unwrap(await request("/api/v4/bootstrap", { cookie }), 200);
  assert.ok(beforeDraft.customers.some((entry) => entry.id === customer.id));
  assert.ok(beforeDraft.projects.some((entry) => entry.id === project.id && entry.customerId === customer.id));
  assert.ok(beforeDraft.billingItems.some((entry) => entry.id === firstItem.id && entry.projectId === project.id));
  assert.ok(beforeDraft.billingItems.some((entry) => entry.id === manualItem.id && entry.projectId === project.id));

  const invoiceDate = "2026-09-28";
  const draft = unwrap(await post("/api/v4/tax-invoices", {
    projectId: project.id,
    invoiceDate,
    billingItemIds: [firstItem.id, manualItem.id],
  }, cookie), 201);
  assert.equal(draft.status, "DRAFT");
  assert.equal(draft.subtotalUsd, 245);
  assert.equal(draft.vatUsd, 24.5);
  assert.equal(draft.totalUsd, 269.5);

  const customerBeforeIssue = unwrap(await request(`/api/v4/customers/${customer.id}`, {
    method: "PATCH",
    body: { ...customer, companyNameEn: "CIJD Snapshot at Issue" },
    cookie,
  }), 200);
  assert.equal(customerBeforeIssue.companyNameEn, "CIJD Snapshot at Issue");

  const issued = unwrap(await post(`/api/v4/tax-invoices/${draft.id}/issue`, {}, cookie), 200);
  assert.equal(issued.status, "ISSUED");
  assert.equal(issued.invoiceNumber, "CIJDTI2026081");
  assert.equal(issued.exchangeRateKhr, 4026);
  assert.equal(issued.totalKhr, 1_085_007);
  assert.equal(issued.customerSnapshot.companyNameEn, "CIJD Snapshot at Issue");
  assert.equal(issued.lines[0].description, "Brand identity");

  const customerAfterIssue = unwrap(await request(`/api/v4/customers/${customer.id}`, {
    method: "PATCH",
    body: { ...customerBeforeIssue, companyNameEn: "CIJD Changed after Issue" },
    cookie,
  }), 200);
  assert.equal(customerAfterIssue.companyNameEn, "CIJD Changed after Issue");
  const frozen = unwrap(await request(`/api/v4/tax-invoices/${draft.id}`, { cookie }), 200);
  assert.equal(frozen.customerSnapshot.companyNameEn, "CIJD Snapshot at Issue");
  assert.equal(frozen.lines[0].description, "Brand identity");

  const changedItem = unwrap(await request(`/api/v4/billing-items/${firstItem.id}`, {
    method: "PATCH",
    body: { ...firstItem, description: "Changed after Issue", finalUnitUsd: 90, finalTotalUsd: 90, readiness: "READY" },
    cookie,
  }), 200);
  assert.equal(changedItem.description, "Changed after Issue");
  const frozenAfterBillingChange = unwrap(await request(`/api/v4/tax-invoices/${draft.id}`, { cookie }), 200);
  assert.equal(frozenAfterBillingChange.lines[0].description, "Brand identity");
  assert.equal(frozenAfterBillingChange.lines[0].amountUsd, 45);

  const cancelled = unwrap(await post(`/api/v4/tax-invoices/${draft.id}/cancel`, { reason: "Local integration verification" }, cookie), 200);
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal(cancelled.invoiceNumber, "CIJDTI2026081");
  const duplicate = unwrap(await post(`/api/v4/tax-invoices/${draft.id}/duplicate`, {}, cookie), 201);
  assert.equal(duplicate.status, "DRAFT");
  assert.equal(duplicate.invoiceNumber, null);
  assert.equal(duplicate.lines[0].description, "Brand identity");

  const failedIssue = await post(`/api/v4/tax-invoices/${duplicate.id}/issue`, {}, cookie);
  assert.equal(failedIssue.response.status, 409, JSON.stringify(failedIssue.body));
  const rolledBack = unwrap(await request(`/api/v4/tax-invoices/${duplicate.id}`, { cookie }), 200);
  assert.equal(rolledBack.status, "DRAFT");
  assert.equal(rolledBack.invoiceNumber, null);
  assert.equal(rolledBack.lines[0].description, "Brand identity", "failed Issue batch must rollback line snapshots");

  const concurrencyItems = await Promise.all(["Concurrent A", "Concurrent B"].map((description) => post("/api/v4/billing-items", {
    ...baseItem,
    description,
    unitCostUsd: 20,
    recommendedTotalUsd: 30,
    finalUnitUsd: 30,
    finalTotalUsd: 30,
  }, cookie).then((result) => unwrap(result, 201))));
  const concurrentDrafts = await Promise.all(concurrencyItems.map((item) => post("/api/v4/tax-invoices", {
    projectId: project.id,
    invoiceDate,
    billingItemIds: [item.id],
  }, cookie).then((result) => unwrap(result, 201))));
  const concurrentIssued = await Promise.all(concurrentDrafts.map((item) => post(`/api/v4/tax-invoices/${item.id}/issue`, {}, cookie)));
  const successfulIssues = concurrentIssued.map((result) => unwrap(result, 200));
  assert.deepEqual(successfulIssues.map((invoice) => invoice.invoiceNumber).sort(), ["CIJDTI2026082", "CIJDTI2026083"]);

  const history = unwrap(await request("/api/v4/bootstrap", { cookie }), 200);
  assert.equal(history.invoices.length, 4);
  assert.ok(history.invoices.some((invoice) => invoice.status === "CANCELLED" && invoice.invoiceNumber === "CIJDTI2026081"));
  assert.ok(history.invoices.some((invoice) => invoice.status === "DRAFT" && invoice.id === duplicate.id));
  assert.equal(history.exchangeRate.rateKhrPerUsd, 4026);

  const checkSql = "SELECT (SELECT count(*) FROM pragma_foreign_key_check) AS fk_errors, (SELECT count(*) FROM tax_invoices WHERE status='ISSUED') AS issued, (SELECT count(*) FROM audit_logs) AS audit_count, (SELECT next_value FROM invoice_number_sequences WHERE year=2026) AS next_number;";
  const check = command(["d1", "execute", database.database_name, "--local", "--config", config, "--persist-to", persistTo, "--command", checkSql, "--json"]);
  const parsed = JSON.parse(check);
  const values = parsed[0]?.results?.[0] ?? parsed.result?.[0]?.results?.[0];
  assert.ok(values, `Could not read local D1 integrity rows: ${check}`);
  assert.equal(Number(values.fk_errors), 0);
  assert.equal(Number(values.issued), 2);
  assert.equal(Number(values.next_number), 84);
  assert.ok(Number(values.audit_count) >= 12);

  console.log("D1 local integration passed: migration, auth, CRUD, pricing, mixed draft, 10% VAT, KHR, concurrent numbering, Issue rollback, snapshot freeze, Cancel, Duplicate, history, FKs, audit log.");
} finally {
  if (worker) await worker.stop();
  if (process.env.CIJD_D1_KEEP_TEST_DB === "1") {
    console.log(`Kept isolated local D1 test state at ${persistTo}`);
  } else {
    await rm(persistTo, { recursive: true, force: true });
  }
}
