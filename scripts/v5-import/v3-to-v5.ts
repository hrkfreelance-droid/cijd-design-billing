/**
 * One-time copy of V3's business data (Supabase) into V5 (its own D1).
 *
 *   # 1. dry run: read V3, write backup + plan + report, change nothing
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run v5:import
 *
 *   # 2. import into the deployed, still-empty V5
 *   … V5_IMPORT_TOKEN=… npm run v5:import -- --target https://<v5>.workers.dev --commit
 *
 *   # 3. verify V3 against V5 record by record (any time later)
 *   … V5_IMPORT_TOKEN=… npm run v5:import -- --target https://<v5>.workers.dev --verify
 *
 *   # offline: from a JSON dump of the V3 tables instead of Supabase
 *   npm run v5:import -- --source-file v3-dump.json [--target … --commit]
 *
 * V3 is only ever READ: every request to Supabase goes through `v3Get`, which
 * refuses anything but GET on /rest/v1/. Nothing in V3 is changed, moved or
 * deleted. Prices are copied as stored; nothing is recalculated.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  compareImport,
  comparisonPasses,
  planV3Import,
  summarize,
  V3_TABLES,
  type ImportPlan,
  type ImportSummary,
  type RecordComparison,
  type V3Rows,
  type V3Table,
} from "../../src/lib/billing-v5/v3-import.ts";

type Row = Record<string, unknown>;

const ORDER: Record<V3Table, string> = {
  clients: "id",
  projects: "id",
  billing_items: "id",
  invoices: "id",
  invoice_items: "invoice_id,billing_item_id",
  payments: "id",
  users: "id",
  service_types: "id",
  exchange_rates: "id",
};
/** Tables a V3 database may predate; missing means "none". */
const OPTIONAL: readonly V3Table[] = ["service_types", "exchange_rates", "payments"];
const PAGE = 1000;

export interface Options {
  sourceFile?: string;
  target?: string;
  commit: boolean;
  verify: boolean;
  out: string;
  allowWarnings: boolean;
}

export function parseArgs(argv: string[]): Options {
  const value = (name: string) => {
    const at = argv.indexOf(name);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  return {
    sourceFile: value("--source-file"),
    target: value("--target")?.replace(/\/+$/, ""),
    commit: argv.includes("--commit"),
    verify: argv.includes("--verify"),
    allowWarnings: !argv.includes("--no-warnings"),
    out: value("--out") ?? path.join(".data", "v5-import", new Date().toISOString().replace(/[:.]/g, "-")),
  };
}

/* ------------------------------------------------------------------ V3: read */

/** The only way this tool talks to V3: a GET on the Supabase REST API. */
export function v3Reader(supabaseUrl: string, key: string, fetcher: typeof fetch = fetch) {
  const base = `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/`;
  async function v3Get(url: string): Promise<Response> {
    if (!url.startsWith(base)) throw new Error(`Refusing a request outside the V3 REST API: ${url}`);
    const init: RequestInit = { method: "GET", headers: { apikey: key, authorization: `Bearer ${key}`, prefer: "count=exact" } };
    if (init.method !== "GET") throw new Error("V3 is read-only for this tool.");
    return fetcher(url, init);
  }

  return async function readTable(table: V3Table): Promise<{ rows: Row[]; missing: boolean }> {
    const rows: Row[] = [];
    let total: number | null = null;
    for (let offset = 0; total === null || offset < total; offset += PAGE) {
      const response = await v3Get(`${base}${table}?select=*&order=${ORDER[table]}&limit=${PAGE}&offset=${offset}`);
      if (!response.ok) {
        const body = await response.text();
        if (OPTIONAL.includes(table) && /42P01|PGRST205/.test(body)) return { rows: [], missing: true };
        throw new Error(`V3 ${table}: HTTP ${response.status} ${body.slice(0, 300)}`);
      }
      const page = (await response.json()) as Row[];
      rows.push(...page);
      const range = response.headers.get("content-range") ?? "";
      const reported = Number(range.split("/")[1]);
      total = Number.isFinite(reported) ? reported : rows.length;
      if (page.length === 0) break;
    }
    if (total !== null && rows.length !== total) {
      throw new Error(`V3 ${table}: read ${rows.length} rows but Supabase reports ${total}. Nothing was imported.`);
    }
    return { rows, missing: false };
  };
}

export async function readV3(options: Options, env: Record<string, string | undefined> = process.env, fetcher: typeof fetch = fetch) {
  if (options.sourceFile) {
    const dump = JSON.parse(readFileSync(options.sourceFile, "utf8")) as Partial<V3Rows>;
    const rows = Object.fromEntries(V3_TABLES.map((table) => [table, dump[table] ?? []])) as V3Rows;
    return { rows, source: `file ${options.sourceFile}`, missing: V3_TABLES.filter((table) => !dump[table]) };
  }
  const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (read-only use), or pass --source-file.");
  const read = v3Reader(url, key, fetcher);
  const rows = {} as V3Rows;
  const missing: V3Table[] = [];
  for (const table of V3_TABLES) {
    const result = await read(table);
    rows[table] = result.rows;
    if (result.missing) missing.push(table);
  }
  return { rows, source: `Supabase ${new URL(url).host}`, missing };
}

/* ------------------------------------------------------------------ V5: write */

async function v5(target: string, token: string, init: RequestInit = {}, fetcher: typeof fetch = fetch) {
  const response = await fetcher(`${target}/api/v5/import`, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  });
  const body = (await response.json().catch(() => null)) as { ok: boolean; data?: V5ReadBack; code?: string; message?: string } | null;
  if (!response.ok || !body?.ok) throw new Error(`V5 import endpoint: HTTP ${response.status} ${body?.code ?? ""} ${body?.message ?? ""}`);
  return body.data!;
}

interface V5ReadBack {
  summary: ImportSummary;
  clients: ImportPlan["collections"]["clients"];
  projects: ImportPlan["collections"]["projects"];
  billingItems: ImportPlan["collections"]["billingItems"];
}

/* ------------------------------------------------------------------ report */

const money = (centsValue: number) => `$${(centsValue / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const verdict = (ok: boolean) => (ok ? "PASS" : "FAIL");

export function renderReport(plan: ImportPlan, source: string, v5?: ImportSummary, comparison?: RecordComparison[], allowExtra = false): string {
  const s = plan.summary;
  const lines = [
    `# V3 → V5 import report`,
    ``,
    `Source: ${source}`,
    ``,
    `V3 CLIENT COUNT: ${s.counts.clients}`,
    `V5 IMPORTED CLIENT COUNT: ${v5 ? v5.counts.clients : "(dry run)"}`,
    ``,
    `V3 PROJECT COUNT: ${s.counts.projects} (active ${s.activeProjects})`,
    `V5 IMPORTED PROJECT COUNT: ${v5 ? `${v5.counts.projects} (active ${v5.activeProjects})` : "(dry run)"}`,
    ``,
    `V3 LINE COUNT: ${s.counts.billingItems} (active ${s.activeLines})`,
    `V5 IMPORTED LINE COUNT: ${v5 ? `${v5.counts.billingItems} (active ${v5.activeLines})` : "(dry run)"}`,
    ``,
  ];
  const byName = (name: string) => comparison?.find((entry) => entry.collection === name);
  const lineCheck = byName("billingItems");
  const projectCheck = byName("projects");
  if (v5 && comparison) {
    lines.push(
      `PRICE PRESERVATION: ${verdict((allowExtra || v5.finalCents === s.finalCents) && !lineCheck?.different.length && !lineCheck?.missing.length)} — Σ Final V3 ${money(s.finalCents)} / V5 ${money(v5.finalCents)}; priced ${s.pricedLines}/${v5.pricedLines}, pending ${s.pendingLines}/${v5.pendingLines}; per-line differences ${lineCheck?.different.length ?? "?"}`,
      `MEMO PRESERVATION: ${verdict((allowExtra || (v5.projectsWithMemo === s.projectsWithMemo && v5.linesWithNote === s.linesWithNote)) && !projectCheck?.different.length && !projectCheck?.missing.length && !lineCheck?.different.length)} — project memos ${s.projectsWithMemo}/${v5.projectsWithMemo}, line notes ${s.linesWithNote}/${v5.linesWithNote}`,
      `STATUS PRESERVATION: ${verdict((allowExtra || (JSON.stringify(v5.billingStatus) === JSON.stringify(s.billingStatus) && JSON.stringify(v5.productionStatus) === JSON.stringify(s.productionStatus) && JSON.stringify(v5.readiness) === JSON.stringify(s.readiness))) && !lineCheck?.different.length && !projectCheck?.different.length)}`,
      `DEPOSITS: ${verdict((allowExtra || v5.depositCents === s.depositCents) && !projectCheck?.different.length)} — ${s.projectsWithDeposit} projects, ${money(s.depositCents)}`,
      `RECORD-BY-RECORD: ${verdict(comparisonPasses(comparison, { allowExtra }))}${allowExtra ? " (every V3 record present and unchanged; records created in V5 since are listed as extra)" : ""}`,
      ...comparison.map((entry) => `  ${entry.collection}: expected ${entry.expected}, found ${entry.found}, missing ${entry.missing.length}, extra ${entry.extra.length}, different ${entry.different.length}${entry.different.length ? ` (${entry.different.slice(0, 10).join(", ")})` : ""}`),
      ``,
    );
  } else {
    lines.push(
      `PRICE (V3): Σ Final ${money(s.finalCents)} over ${s.pricedLines} priced lines, ${s.pendingLines} pending`,
      `MEMOS (V3): ${s.projectsWithMemo} project memos, ${s.linesWithNote} line notes`,
      `STATUS (V3): billing ${JSON.stringify(s.billingStatus)} production ${JSON.stringify(s.productionStatus)} readiness ${JSON.stringify(s.readiness)}`,
      `DEPOSITS (V3): ${s.projectsWithDeposit} projects, ${money(s.depositCents)}`,
      ``,
    );
  }
  lines.push(
    `Other copied records: ${Object.entries(s.counts).filter(([key]) => !["clients", "projects", "billingItems"].includes(key)).map(([key, count]) => `${key} ${count}`).join(", ")}`,
    ``,
    `## Records that could not be mapped safely (${plan.issues.length})`,
    ...(plan.issues.length ? plan.issues.map((i) => `- [${i.severity}] ${i.table} ${i.id}: ${i.code} — ${i.detail}`) : ["- none"]),
  );
  return lines.join("\n");
}

/* ------------------------------------------------------------------ main */

export async function run(options: Options, env: Record<string, string | undefined> = process.env, fetcher: typeof fetch = fetch, log = console.log) {
  const { rows, source, missing } = await readV3(options, env, fetcher);
  const plan = planV3Import(rows);
  mkdirSync(options.out, { recursive: true });
  writeFileSync(path.join(options.out, "v3-backup.json"), JSON.stringify(rows));
  writeFileSync(path.join(options.out, "v5-plan.json"), JSON.stringify(plan));
  if (missing.length) log(`Note: V3 has no ${missing.join(", ")} table(s); imported as empty.`);

  const blocking = plan.issues.filter((issue) => issue.severity === "BLOCKING");
  const warnings = plan.issues.filter((issue) => issue.severity === "WARNING");
  let stored: V5ReadBack | undefined;

  if (options.commit || options.verify) {
    const token = env.V5_IMPORT_TOKEN;
    if (!options.target || !token) throw new Error("--commit/--verify need --target <V5 URL> and V5_IMPORT_TOKEN.");
    if (/cijd-design-billing-(preview|v4-preview)\./.test(options.target)) {
      throw new Error(`Refusing: ${options.target} is not the V5 Worker.`);
    }
    if (options.commit) {
      if (blocking.length) throw new Error(`${blocking.length} blocking issue(s); nothing was imported. See ${options.out}/report.md`);
      if (warnings.length && !options.allowWarnings) throw new Error(`${warnings.length} warning(s) and --no-warnings; nothing was imported.`);
      stored = await v5(options.target, token, { method: "POST", body: JSON.stringify({ collections: plan.collections, source }) }, fetcher);
    } else {
      stored = await v5(options.target, token, { method: "GET" }, fetcher);
    }
  }

  const comparison = stored
    ? compareImport(plan.collections, { clients: stored.clients, projects: stored.projects, billingItems: stored.billingItems }, { activeOnly: false })
    : undefined;
  // After a commit V5 must hold exactly V3; a later --verify allows V5's own new records.
  const allowExtra = !options.commit;
  const report = renderReport(plan, source, stored?.summary, comparison, allowExtra);
  writeFileSync(path.join(options.out, "report.md"), report);
  log(report);
  log(`\nFiles: ${options.out}/{v3-backup.json,v5-plan.json,report.md}${options.commit || options.verify ? "" : "  (dry run: V5 not touched)"}`);
  return { plan, stored, comparison, passed: comparison
      ? comparisonPasses(comparison, { allowExtra }) && (allowExtra || summarize(plan.collections).finalCents === stored!.summary.finalCents)
      : null };
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  run(parseArgs(process.argv.slice(2)))
    .then((result) => {
      if (result.passed === false) process.exitCode = 1;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
