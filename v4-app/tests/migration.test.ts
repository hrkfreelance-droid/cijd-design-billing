import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const migration = await readFile(path.resolve(import.meta.dirname, "../migrations/0001_v4_initial.sql"), "utf8");

test("D1 migration creates the isolated V4 domain tables and no V3 foreign keys", () => {
  for (const table of ["customers", "projects", "billing_items", "tax_invoices", "tax_invoice_lines", "exchange_rates", "audit_logs", "billing_item_claims", "invoice_number_sequences"]) {
    assert.match(migration, new RegExp(`create table ${table}\\b`, "i"));
  }
  assert.doesNotMatch(migration, /dldfhhcechzhkbvlnzld/);
  assert.doesNotMatch(migration, /public\.|billing_v[23]|supabase/i);
  assert.match(migration, /references customers\(id\)/i);
  assert.match(migration, /references projects\(id\)/i);
  assert.match(migration, /references billing_items\(id\)/i);
  assert.match(migration, /references tax_invoices\(id\)/i);
});

test("integer money, unique invoice numbers, cent rounding fields, and frozen snapshots are enforced", () => {
  assert.match(migration, /invoice_number text unique/i);
  assert.match(migration, /subtotal_cents integer/i);
  assert.match(migration, /vat_cents integer/i);
  assert.match(migration, /usd_total_cents integer/i);
  assert.match(migration, /khr_total integer/i);
  assert.match(migration, /tax_invoice_issued_snapshot_guard/i);
  assert.match(migration, /tax_invoice_line_update_guard/i);
  assert.match(migration, /billing_item_claim_ready_guard/i);
  assert.match(migration, /values \(2026, 81\)/i);
});

test("schema stores quantity at four decimal places and limits invoice lifecycle", () => {
  assert.match(migration, /quantity_units integer not null check \(quantity_units > 0\)/i);
  assert.match(migration, /status text not null default 'DRAFT' check \(status in \('DRAFT', 'ISSUED', 'CANCELLED'\)\)/i);
  assert.match(migration, /vat_rate_basis_points integer not null default 1000 check \(vat_rate_basis_points = 1000\)/i);
});
