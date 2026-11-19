/**
 * Compare V3 history to V5 by stable project/line ID. Source access is GET-only.
 * Writes are limited to the local V5 D1, in the isolated history table.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs as parseCli } from "node:util";
import { isHistoricalRecord } from "../../src/lib/derive";
import type { LegacyProject } from "../../src/lib/billing-v5/project-history";
import { planV3Import, type ImportPlan } from "../../src/lib/billing-v5/v3-import";
import { parseArgs, readV3 } from "./v3-to-v5";

const db = "cijd-design-billing-v5-preview";
const preview = `https://${db}.hrk-freelance.workers.dev/api/state`;
const root = fileURLToPath(new URL("../../", import.meta.url));
const nativeIds = (collection: string) =>
  `SELECT json_extract(row.value, '$.id') AS id FROM v5_state, json_each(v5_state.data) AS row
    WHERE collection = '${collection}' OR collection GLOB '${collection}#[0-9]*'`;

export function missingHistory(plan: ImportPlan, targetProjects: Set<string>, targetItems: Set<string>) {
  const { clients, projects, billingItems, invoices, invoiceItems, payments } = plan.collections;
  const clientById = new Map(clients.map((client) => [client.id, client]));
  const rows: LegacyProject[] = [];
  const counts = { sourceArchived: 0, present: 0, liveOnlyInV3: 0, missingLinesOnExistingProjects: 0, orphaned: 0 };
  for (const project of projects.filter((entry) => !entry.deletedAt)) {
    const items = billingItems.filter((item) => item.projectId === project.id && !item.deletedAt);
    const archived = items.length > 0 && items.every((item) =>
      isHistoricalRecord(item) || item.billingStatus === "INVOICED" || item.billingStatus === "PAID",
    );
    if (archived) counts.sourceArchived++;
    if (targetProjects.has(project.id)) {
      if (archived) counts.present++;
      counts.missingLinesOnExistingProjects += items.filter((item) => !targetItems.has(item.id)).length;
      continue;
    }
    if (!archived) {
      counts.liveOnlyInV3++;
      continue;
    }
    const client = clientById.get(project.clientId);
    if (!client) {
      counts.orphaned++;
      continue;
    }
    const links = invoices.flatMap((invoice) => {
      const itemIds = items.filter((item) => item.invoiceId === invoice.id ||
        invoiceItems.some((link) => link.invoiceId === invoice.id && link.billingItemId === item.id)).map(({ id }) => id);
      return itemIds.length ? [{ ...invoice, itemIds, paymentSlip: undefined }] : [];
    });
    const invoiceIds = new Set(links.map(({ id }) => id));
    rows.push({
      project,
      client: { id: client.id, name: client.name },
      items,
      invoices: links,
      payments: payments.filter((payment) => invoiceIds.has(payment.invoiceId)).map((payment) => ({ ...payment, slip: undefined })),
    });
  }
  return { rows, counts };
}

async function getOnly(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.method !== "GET") throw new Error("Only GET is permitted.");
  const url = new URL(String(input));
  if (url.protocol !== "https:") throw new Error("The source URL must use HTTPS.");
  return fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(60_000) });
}

function executeLocal(persist: string, ...args: string[]) {
  const raw = execFileSync(path.join(root, "node_modules/.bin/wrangler"), [
    "d1", "execute", db, "--local", "--config", "wrangler.v5.jsonc", "--persist-to", path.resolve(persist), "--json", ...args,
  ], {
    cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: path.resolve(persist, "logs") },
  });
  return JSON.parse(raw) as { success: boolean; results: { id: string }[] }[];
}

async function main() {
  const { values } = parseCli({ options: {
    "source-file": { type: "string" },
    "persist-to": { type: "string", default: ".wrangler/v5-local" },
    "audit-preview": { type: "boolean" },
    apply: { type: "boolean" },
  } });
  if (values["audit-preview"] && values.apply) throw new Error("Preview audits cannot write.");
  const options = values["source-file"] ? ["--source-file", values["source-file"]] : [];
  const { rows, missing } = await readV3(parseArgs(options), process.env, getOnly);
  if (missing.some((entry) => ["projects", "clients", "billing_items"].includes(entry))) throw new Error("Missing source collections.");
  const plan = planV3Import(rows);
  const issueCounts = { blocking: 0, warnings: 0 };
  for (const issue of plan.issues) {
    if (issue.severity === "BLOCKING") issueCounts.blocking++;
    else issueCounts.warnings++;
  }
  console.log(JSON.stringify({ sourceIssues: issueCounts }));
  if (issueCounts.blocking) throw new Error("Source validation failed.");

  let projects: string[];
  let items: string[];
  let existingHistory = new Set<string>();
  if (values["audit-preview"]) {
    const response = await getOnly(preview, { method: "GET" });
    if (!response.ok) throw new Error("V5 preview snapshot unavailable.");
    const { data } = await response.json() as { data: { projects: { id: string }[]; billingItems: { id: string }[] } };
    projects = data.projects.map(({ id }) => id);
    items = data.billingItems.map(({ id }) => id);
  } else {
    const historyQuery = values.apply ? "; SELECT project_id AS id FROM v5_project_history" : "";
    const [existingProjects, existingItems, history] = executeLocal(values["persist-to"], "--command", `${nativeIds("projects")}; ${nativeIds("billingItems")}${historyQuery}`);
    existingHistory = new Set(history?.results.map(({ id }) => id));
    projects = existingProjects.results.map(({ id }) => id);
    items = existingItems.results.map(({ id }) => id);
  }

  const result = missingHistory(plan, new Set(projects), new Set(items));
  const report = { ...result.counts, eligible: result.rows.length, missingTables: missing.length };
  const pending = result.rows.filter((entry) => !existingHistory.has(entry.project.id));
  if (!values.apply || !pending.length) {
    console.log(JSON.stringify({ ...report, inserted: 0 }));
    return;
  }

  const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
  const dir = mkdtempSync(path.join(tmpdir(), "cijd-v5-history-"));
  try {
    const file = path.join(dir, "history.sql");
    const statements = pending.map((entry) => {
      const id = quote(entry.project.id);
      return `INSERT OR IGNORE INTO v5_project_history (project_id, snapshot)
        SELECT ${id}, ${quote(JSON.stringify(entry))}
        WHERE NOT EXISTS (SELECT 1 FROM (${nativeIds("projects")}) WHERE id = ${id});`;
    });
    writeFileSync(file, statements.join("\n"), { mode: 0o600 });
    executeLocal(values["persist-to"], "--file", file);
    const [history] = executeLocal(values["persist-to"], "--command", "SELECT project_id AS id FROM v5_project_history");
    const saved = new Set(history.results.map(({ id }) => id));
    const inserted = pending.filter(({ project }) => saved.has(project.id)).length;
    console.log(JSON.stringify({ ...report, inserted }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(() => {
    // Upstream error responses and local SQL can contain private source values.
    console.error("History import failed. Check source access/format, local V5 migrations, and the supplied options.");
    process.exitCode = 1;
  });
}
