/**
 * V5 deploy reconciliation. GET only — never writes to any Worker.
 *
 *   # save the live V5 state (before / after a deploy)
 *   npm run -s v5:reconcile -- --save <v5-url> <file.json>
 *
 *   # compare: every existing record, number, total, billing link and payment state
 *   npm run -s v5:reconcile -- <before.json> <after.json> [--out report.md] [--allow-new-real-numbers]
 *
 * Exit 0 = PASS, 1 = a difference (the report lists it). The files hold
 * business data: keep them under .data/ (git-ignored).
 */
import { writeFileSync, readFileSync } from "node:fs";

import { invoiceLedger, reconcileV5 } from "../src/lib/billing-v5/reconcile.ts";

const args = process.argv.slice(2);

async function save(url: string, file: string) {
  const response = await fetch(`${url.replace(/\/$/, "")}/api/state`, { method: "GET", headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`GET ${url}/api/state → HTTP ${response.status}`);
  const body = (await response.json()) as { data?: unknown };
  if (!body.data || typeof body.data !== "object") throw new Error("Unexpected /api/state response.");
  writeFileSync(file, JSON.stringify(body.data, null, 2));
  const data = body.data as { taxInvoices?: unknown[]; projects?: unknown[]; clients?: unknown[] };
  console.log(`saved ${file}: ${data.clients?.length ?? 0} clients, ${data.projects?.length ?? 0} projects, ${data.taxInvoices?.length ?? "no"} tax invoices`);
}

function compare(beforeFile: string, afterFile: string) {
  const read = (file: string) => {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    return (raw && typeof raw === "object" && "data" in raw ? raw.data : raw) as Record<string, unknown>;
  };
  const before = read(beforeFile);
  const after = read(afterFile);
  const result = reconcileV5(before, after, { allowNewRealNumbers: args.includes("--allow-new-real-numbers") });
  const lines = [
    `# V5 reconciliation — ${result.ok ? "PASS" : "FAIL"}`,
    "",
    `before: ${beforeFile}`,
    `after:  ${afterFile}`,
    "",
    "| check | result | detail |",
    "|---|---|---|",
    ...result.checks.map((c) => `| ${c.name} | ${c.ok ? "PASS" : "FAIL"} | ${c.detail.replace(/\|/g, "/")} |`),
    "",
    "| collection | before | after |",
    "|---|---:|---:|",
    ...Object.entries(result.counts).map(([name, c]) => `| ${name} | ${c.before} | ${c.after} |`),
    "",
    "## Existing invoice numbers (before)",
    "",
    "| number | status | total USD | total KHR | customer |",
    "|---|---|---:|---:|---|",
    ...invoiceLedger(before).map((i) => `| ${i.number} | ${i.status} | ${i.totalUsd.toFixed(2)} | ${i.totalKhr} | ${i.customer.replace(/\|/g, "/")} |`),
  ];
  const report = lines.join("\n") + "\n";
  const out = args[args.indexOf("--out") + 1];
  if (args.includes("--out") && out) writeFileSync(out, report);
  console.log(report);
  process.exit(result.ok ? 0 : 1);
}

if (args[0] === "--save") {
  await save(args[1], args[2]);
} else if (args.length >= 2) {
  compare(args[0], args[1]);
} else {
  console.error("usage: --save <url> <file> | <before.json> <after.json> [--out report.md] [--allow-new-real-numbers]");
  process.exit(2);
}
