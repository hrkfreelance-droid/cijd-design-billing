/**
 * Deploy reconciliation: compares two `/api/state` snapshots of the V5
 * Worker — one taken before a deploy (possibly by the older code, so newer
 * collections may be missing) and one after — and proves that nothing that
 * existed before was changed, renumbered or lost. Records created later are
 * allowed and only counted. Pure: no I/O, used by scripts/v5-reconcile.ts.
 */
import { invoiceCollection } from "./ontology";
import type { Snapshot, TaxInvoiceRecord } from "../types";

type AnySnapshot = Partial<Snapshot> & Record<string, unknown>;

export interface ReconcileCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface ReconcileResult {
  ok: boolean;
  checks: ReconcileCheck[];
  counts: Record<string, { before: number; after: number }>;
}

/** Collections whose existing records must come out of a deploy unchanged. */
export const PRESERVED = ["clients", "projects", "billingItems", "invoices", "invoiceItems", "projectPayments", "clientTaxProfiles", "taxInvoices", "customers", "products", "billingAllocations", "invoicePayments", "invoiceRevisions"] as const;

const REAL_NUMBER = /^CIJDTI(\d{4})(\d{3,})$/;

function keyOf(record: Record<string, unknown>): string {
  if (typeof record.id === "string") return record.id;
  return [record.invoiceId, record.clientId, record.billingItemId].filter((part) => part !== undefined).join(":");
}

function list(snapshot: AnySnapshot, name: string): Record<string, unknown>[] {
  const value = snapshot[name];
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

/** Stable JSON: key order does not count as a change. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as object)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const cents = (value: number) => Math.round(value * 100);

export function reconcileV5(before: AnySnapshot, after: AnySnapshot, options: { allowNewRealNumbers?: boolean } = {}): ReconcileResult {
  const checks: ReconcileCheck[] = [];
  const check = (name: string, problems: string[], okDetail: string) =>
    checks.push({ name, ok: problems.length === 0, detail: problems.length ? problems.slice(0, 20).join("; ") + (problems.length > 20 ? ` … (+${problems.length - 20})` : "") : okDetail });

  // 1. Every existing record is still there, byte for byte.
  for (const name of PRESERVED) {
    const now = new Map(list(after, name).map((record) => [keyOf(record), record]));
    const problems: string[] = [];
    for (const record of list(before, name)) {
      const current = now.get(keyOf(record));
      if (!current) problems.push(`${keyOf(record)} missing`);
      else if (canonical(current) !== canonical(record)) problems.push(`${keyOf(record)} changed`);
    }
    check(`${name} unchanged`, problems, `${list(before, name).length} existing record(s) identical`);
  }

  // 2. Invoice numbers: same invoice, same number; unique; no reuse or renumbering.
  const beforeInvoices = list(before, "taxInvoices") as unknown as TaxInvoiceRecord[];
  const afterInvoices = list(after, "taxInvoices") as unknown as TaxInvoiceRecord[];
  {
    const problems: string[] = [];
    const seen = new Map<string, string>();
    for (const invoice of afterInvoices) {
      const other = seen.get(invoice.invoiceNumber);
      if (other) problems.push(`${invoice.invoiceNumber} used by ${other} and ${invoice.id}`);
      seen.set(invoice.invoiceNumber, invoice.id);
    }
    const existing = new Set(beforeInvoices.map((invoice) => invoice.id));
    const maxBefore = new Map<string, number>();
    for (const invoice of beforeInvoices) {
      const match = REAL_NUMBER.exec(invoice.invoiceNumber);
      if (match) maxBefore.set(match[1], Math.max(maxBefore.get(match[1]) ?? 0, Number(match[2])));
    }
    for (const invoice of afterInvoices) {
      if (existing.has(invoice.id)) continue;
      const match = REAL_NUMBER.exec(invoice.invoiceNumber);
      if (!match) continue;
      if (!options.allowNewRealNumbers) problems.push(`new real number ${invoice.invoiceNumber} was consumed`);
      else if (Number(match[2]) <= (maxBefore.get(match[1]) ?? 0)) problems.push(`new ${invoice.invoiceNumber} is not after the existing series`);
    }
    check("invoice numbers", problems, `${beforeInvoices.length} existing number(s) kept; ${afterInvoices.length - beforeInvoices.length} new (TEST series only)`);
  }

  // 3. Billing links: each existing invoice's billed lines are allocated exactly once.
  const allocations = list(after, "billingAllocations") as unknown as NonNullable<Snapshot["billingAllocations"]>;
  const revisions = list(after, "invoiceRevisions") as unknown as NonNullable<Snapshot["invoiceRevisions"]>;
  if (after.billingAllocations !== undefined) {
    const problems: string[] = [];
    for (const invoice of beforeInvoices) {
      const expected = new Map<string, number>();
      for (const line of invoice.lines) {
        if (line.billingItemId) expected.set(line.billingItemId, (expected.get(line.billingItemId) ?? 0) + cents(line.amount));
      }
      const mine = allocations.filter((allocation) => allocation.invoiceId === invoice.id);
      const got = new Map<string, number>();
      for (const allocation of mine) {
        if (!!allocation.voidedAt !== (invoice.status === "CANCELLED")) problems.push(`${invoice.invoiceNumber}: allocation ${allocation.id} voided=${!!allocation.voidedAt}`);
        got.set(allocation.billingItemId, (got.get(allocation.billingItemId) ?? 0) + cents(allocation.amount));
      }
      for (const [id, amount] of expected) if (got.get(id) !== amount) problems.push(`${invoice.invoiceNumber}: ${id} allocated ${(got.get(id) ?? 0) / 100}, lines ${amount / 100}`);
      for (const id of got.keys()) if (!expected.has(id)) problems.push(`${invoice.invoiceNumber}: unexpected allocation for ${id}`);
      if (!revisions.some((revision) => revision.invoiceId === invoice.id)) problems.push(`${invoice.invoiceNumber}: no revision history`);
    }
    check("billing links and history", problems, `${beforeInvoices.length} existing invoice(s) linked to their billing lines, with history`);
  } else {
    check("billing links and history", ["the after snapshot has no billingAllocations (new code not deployed?)"], "");
  }

  // 4. Payment state: what was paid stays paid; cancelled stays at zero.
  {
    const problems: string[] = [];
    // "Paid" is what the ledger said before the deploy.
    const ledger = new Map(list(before, "invoices").map((entry) => [entry.id as string, entry]));
    for (const invoice of beforeInvoices) {
      const current = afterInvoices.find((entry) => entry.id === invoice.id);
      if (!current) continue;
      const state = invoiceCollection(after as unknown as Parameters<typeof invoiceCollection>[0], current);
      if (invoice.status === "CANCELLED" && state.totalUsd !== 0) problems.push(`${invoice.invoiceNumber}: cancelled but total ${state.totalUsd}`);
      if (ledger.get(invoice.ledgerInvoiceId)?.status === "PAID" && state.status !== "PAID") problems.push(`${invoice.invoiceNumber}: marked paid before, now ${state.status}`);
    }
    check("payment state", problems, "paid invoices collected, cancelled at zero");
  }

  const counts: ReconcileResult["counts"] = {};
  for (const name of PRESERVED) {
    counts[name] = { before: list(before, name).length, after: list(after, name).length };
  }
  return { ok: checks.every((entry) => entry.ok), checks, counts };
}

/** Existing invoice numbers with their totals, for the report. */
export function invoiceLedger(snapshot: AnySnapshot): { number: string; status: string; totalUsd: number; totalKhr: number; customer: string }[] {
  return (list(snapshot, "taxInvoices") as unknown as TaxInvoiceRecord[])
    .map((invoice) => ({ number: invoice.invoiceNumber, status: invoice.status, totalUsd: invoice.totalUsd, totalKhr: invoice.totalKhr, customer: invoice.customer.companyNameEn || invoice.customer.companyNameKm }))
    .sort((a, b) => a.number.localeCompare(b.number));
}
