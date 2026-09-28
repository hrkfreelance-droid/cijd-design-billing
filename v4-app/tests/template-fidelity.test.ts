import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const component = await readFile(path.join(root, "src/ui/invoice-document.tsx"), "utf8");
const css = await readFile(path.join(root, "src/app/globals.css"), "utf8");

test("A4 geometry follows the audited Excel page setup", () => {
  assert.match(css, /width: 210mm/);
  assert.match(css, /min-height: 297mm/);
  assert.match(css, /padding: 19\.05mm 17\.78mm/);
  assert.match(css, /invoice-company \{ position: relative; height: 35mm;/);
  assert.match(css, /invoice-title \{ height: 16mm;/);
  assert.match(css, /invoice-parties \{ display: grid; grid-template-columns: 66% 34%; min-height: 36mm;/);
  assert.match(css, /bank-accounts \{ display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; height: 27mm; padding-top: 3mm;/);
  assert.match(css, /invoice-signatures div \{ padding-top: 5mm;/);
  assert.match(css, /@page \{ size: A4 portrait; margin: 0; \}/);
  assert.match(css, /invoice-signatures \{ break-inside: avoid; page-break-inside: avoid; \}/);
  assert.match(css, /width: 4\.66%/);
  assert.match(css, /width: 51\.74%/);
  assert.match(css, /width: 14\.53%/);
});

test("representative sheet bilingual hierarchy and totals remain present", () => {
  for (const text of [
    "វិក្កយបត្រអាករ",
    "TAX INVOICE",
    "បរិយាយមុខទំនិញ",
    "Description",
    "VAT (10%)",
    "Grand Total in USD",
    "Grand Total in Riel",
    "Customer&apos;s Signature &amp; Name",
    "Seller&apos;s Signature &amp; Name",
  ]) assert.ok(component.includes(text), `missing template text: ${text}`);
});
