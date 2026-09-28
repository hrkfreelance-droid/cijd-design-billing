#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const targets = ["src", "worker", "migrations", "wrangler.jsonc", "package.json", "package-lock.json", ".env.example"];
const banned = [
  ["legacy office route", "/office-" + "v3"],
  ["legacy invoice API", "/api/" + "invoices"],
  ["legacy billing API", "/api/" + "billing-v2"],
  ["forbidden V3 project ref", "dldfhhcechzhkbvlnzld"],
  ["legacy component", "Billing" + "V3Board"],
  ["legacy repository", "billing-v2/" + "repository"],
  ["Supabase package/import", "@supabase"],
  ["Supabase environment", "SUPABASE_"],
  ["Supabase PostgREST", "/rest/" + "v1/"],
  ["V3 Preview Worker URL", "cijd-design-billing-preview.hrk-freelance.workers.dev"],
];

async function filesAt(relative) {
  const absolute = path.join(root, relative);
  try {
    const entries = await readdir(absolute, { withFileTypes: true });
    const nested = await Promise.all(entries.map((entry) =>
      entry.isDirectory() ? filesAt(path.join(relative, entry.name)) : [path.join(relative, entry.name)],
    ));
    return nested.flat();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOTDIR") return [relative];
    throw error;
  }
}

const files = (await Promise.all(targets.map(filesAt))).flat();
const violations = [];
for (const file of files) {
  const source = await readFile(path.join(root, file), "utf8");
  for (const [name, needle] of banned) {
    if (source.includes(needle)) violations.push(`${file}: ${name}`);
  }
  if (file.startsWith("src/app/api/") && file.endsWith("route.ts")) {
    violations.push(`${file}: API routes must be dispatched only by the isolated Worker`);
  }
}

if (violations.length) {
  console.error(violations.join("\n"));
  process.exit(1);
}
console.log(`architecture guard passed (${files.length} files scanned)`);
