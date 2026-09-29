/**
 * One-time copy of V3's business data into V5.
 *
 * V3's rows (read-only, from Supabase) are turned into V5 records with the
 * very same mappers V3 itself uses to show them (`src/lib/supabase/rows.ts`),
 * so V5 holds exactly what V3 shows:
 *
 *   - IDs are kept (V5's database is separate, so they cannot collide)
 *   - Final prices, unit prices, quantities, costs and markups are copied as
 *     stored — nothing is recalculated
 *   - no V5 `finalMode` is written: legacy rows keep the V3 (inferred) reading
 *   - memos, statuses, deposits, ledger entries and payments are copied
 *   - soft-deleted rows are copied as deleted, so nothing disappears
 *
 * Anything that cannot be mapped safely is reported, never changed.
 */
import {
  toClient,
  toExchangeRate,
  toInvoice,
  toInvoiceItem,
  toItem,
  toPayment,
  toProject,
  toServiceType,
  toUser,
} from "../supabase/rows";
import {
  BILLING_STATUSES,
  ITEM_TYPES,
  PRODUCTION_STATUSES,
  type BillingItem,
  type Client,
  type Database,
  type Project,
} from "../types";

type Row = Record<string, unknown>;

export const V3_TABLES = [
  "clients",
  "projects",
  "billing_items",
  "invoices",
  "invoice_items",
  "payments",
  "users",
  "service_types",
  "exchange_rates",
] as const;
export type V3Table = (typeof V3_TABLES)[number];
export type V3Rows = Record<V3Table, Row[]>;

export type IssueSeverity = "BLOCKING" | "WARNING";
export interface ImportIssue {
  severity: IssueSeverity;
  table: V3Table;
  id: string;
  code: string;
  detail: string;
}

/** The business collections V5 takes from V3. */
export const IMPORTED_COLLECTIONS = [
  "clients",
  "projects",
  "billingItems",
  "invoices",
  "invoiceItems",
  "payments",
  "users",
  "serviceTypes",
  "exchangeRates",
] as const satisfies readonly (keyof Database)[];
export type ImportedCollection = (typeof IMPORTED_COLLECTIONS)[number];

export interface ImportSummary {
  counts: Record<ImportedCollection, number>;
  /** Projects / lines that are not soft-deleted — what the screens show. */
  activeProjects: number;
  activeLines: number;
  /** Σ Final amount over active priced lines, in cents. */
  finalCents: number;
  pricedLines: number;
  pendingLines: number;
  projectsWithMemo: number;
  linesWithNote: number;
  projectsWithDeposit: number;
  depositCents: number;
  billingStatus: Record<string, number>;
  productionStatus: Record<string, number>;
  readiness: Record<string, number>;
}

export interface ImportPlan {
  /** Business collections to write into V5, exactly as mapped. */
  collections: Pick<Database, ImportedCollection>;
  summary: ImportSummary;
  issues: ImportIssue[];
}

const cents = (amount: number) => Math.round((amount + Number.EPSILON) * 100);

function tally(values: readonly (string | null | undefined)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) out[value ?? "∅"] = (out[value ?? "∅"] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

export function summarize(collections: Pick<Database, ImportedCollection>): ImportSummary {
  const activeProjects = collections.projects.filter((project) => !project.deletedAt);
  const activeLines = collections.billingItems.filter((item) => !item.deletedAt);
  const priced = activeLines.filter((item) => item.amount != null);
  return {
    counts: Object.fromEntries(IMPORTED_COLLECTIONS.map((key) => [key, collections[key].length])) as Record<ImportedCollection, number>,
    activeProjects: activeProjects.length,
    activeLines: activeLines.length,
    finalCents: priced.reduce((sum, item) => sum + cents(item.amount as number), 0),
    pricedLines: priced.length,
    pendingLines: activeLines.length - priced.length,
    projectsWithMemo: activeProjects.filter((project) => (project.note ?? "").trim() !== "").length,
    linesWithNote: activeLines.filter((item) => (item.note ?? "").trim() !== "").length,
    projectsWithDeposit: activeProjects.filter((project) => (project.depositAmount ?? 0) > 0).length,
    depositCents: activeProjects.reduce((sum, project) => sum + cents(project.depositAmount ?? 0), 0),
    billingStatus: tally(activeLines.map((item) => item.billingStatus)),
    productionStatus: tally(activeLines.map((item) => item.productionStatus)),
    readiness: tally(activeProjects.map((project) => project.billingReadiness ?? "AUTO")),
  };
}

function numbersOk(values: Record<string, number | null | undefined>): string | null {
  for (const [name, value] of Object.entries(values)) {
    if (value != null && !Number.isFinite(value)) return name;
  }
  return null;
}

/** V3 rows → V5 records, plus everything that could not be mapped safely. */
export function planV3Import(rows: V3Rows): ImportPlan {
  const issues: ImportIssue[] = [];
  const issue = (severity: IssueSeverity, table: V3Table, id: string, code: string, detail: string) =>
    issues.push({ severity, table, id, code, detail });

  const collections: Pick<Database, ImportedCollection> = {
    clients: rows.clients.map(toClient),
    projects: rows.projects.map(toProject),
    billingItems: rows.billing_items.map(toItem),
    invoices: rows.invoices.map(toInvoice),
    invoiceItems: rows.invoice_items.map(toInvoiceItem),
    payments: rows.payments.map(toPayment),
    users: rows.users.map(toUser),
    serviceTypes: rows.service_types.map(toServiceType),
    exchangeRates: rows.exchange_rates.map(toExchangeRate),
  };

  // Duplicate or missing IDs would make a copy ambiguous.
  const tableOf: Record<string, V3Table> = {
    clients: "clients", projects: "projects", billingItems: "billing_items", invoices: "invoices",
    payments: "payments", users: "users", serviceTypes: "service_types", exchangeRates: "exchange_rates",
  };
  for (const [key, table] of Object.entries(tableOf)) {
    const seen = new Set<string>();
    for (const record of collections[key as ImportedCollection] as { id: string }[]) {
      if (!record.id) issue("BLOCKING", table, "", "MISSING_ID", "A row has no id.");
      else if (seen.has(record.id)) issue("BLOCKING", table, record.id, "DUPLICATE_ID", "The id appears twice.");
      seen.add(record.id);
    }
  }

  const clients = new Map<string, Client>(collections.clients.map((client) => [client.id, client]));
  const projects = new Map<string, Project>(collections.projects.map((project) => [project.id, project]));
  const invoices = new Set(collections.invoices.map((invoice) => invoice.id));
  const items = new Map<string, BillingItem>(collections.billingItems.map((item) => [item.id, item]));

  for (const project of collections.projects) {
    if (!clients.has(project.clientId)) {
      issue("WARNING", "projects", project.id, "ORPHAN_PROJECT", `Client ${project.clientId} does not exist; copied as is.`);
    }
    const bad = numbersOk({ depositAmount: project.depositAmount });
    if (bad) issue("BLOCKING", "projects", project.id, "INVALID_NUMBER", `${bad} is not a number.`);
  }

  for (const item of collections.billingItems) {
    if (!projects.has(item.projectId)) {
      issue("WARNING", "billing_items", item.id, "ORPHAN_LINE", `Project ${item.projectId} does not exist; copied as is.`);
    }
    if (item.invoiceId && !invoices.has(item.invoiceId)) {
      issue("WARNING", "billing_items", item.id, "MISSING_LEDGER_ENTRY", `Invoice ${item.invoiceId} does not exist; copied as is.`);
    }
    const bad = numbersOk({
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      amount: item.amount,
      printCost: item.printCost,
      markupOverride: item.markupOverride,
    });
    if (bad) issue("BLOCKING", "billing_items", item.id, "INVALID_NUMBER", `${bad} is not a number.`);
    if (!(ITEM_TYPES as readonly string[]).includes(item.type)) {
      issue("WARNING", "billing_items", item.id, "UNKNOWN_TYPE", `type "${item.type}" is not a V3 type; copied as is.`);
    }
    if (!(BILLING_STATUSES as readonly string[]).includes(item.billingStatus)) {
      issue("WARNING", "billing_items", item.id, "UNKNOWN_STATUS", `billing_status "${item.billingStatus}"; copied as is.`);
    }
    if (!(PRODUCTION_STATUSES as readonly string[]).includes(item.productionStatus)) {
      issue("WARNING", "billing_items", item.id, "UNKNOWN_STATUS", `production_status "${item.productionStatus}"; copied as is.`);
    }
    if (item.amount != null && Number.isFinite(item.amount) && cents(item.amount) / 100 !== item.amount) {
      issue("WARNING", "billing_items", item.id, "SUB_CENT_AMOUNT", `amount ${item.amount} has more than 2 decimals; copied as is.`);
    }
  }

  for (const link of collections.invoiceItems) {
    if (!invoices.has(link.invoiceId) || !items.has(link.billingItemId)) {
      issue("WARNING", "invoice_items", `${link.invoiceId}/${link.billingItemId}`, "ORPHAN_LINK", "Points at a missing invoice or line; copied as is.");
    }
  }
  for (const payment of collections.payments) {
    if (!invoices.has(payment.invoiceId)) {
      issue("WARNING", "payments", payment.id, "ORPHAN_PAYMENT", `Invoice ${payment.invoiceId} does not exist; copied as is.`);
    }
    const bad = numbersOk({ amount: payment.amount });
    if (bad) issue("BLOCKING", "payments", payment.id, "INVALID_NUMBER", `${bad} is not a number.`);
  }

  return { collections, summary: summarize(collections), issues };
}

/* ------------------------------------------------------------ verification */

/** What must be identical in V3 and V5, record by record. */
export function clientKey(client: Client): string {
  return JSON.stringify([client.id, client.name, client.active]);
}

export function projectKey(project: Project): string {
  return JSON.stringify([
    project.id, project.clientId, project.name, project.date, project.note ?? "",
    project.billingReadiness ?? "AUTO", project.depositAmount ?? null, project.deletedAt ?? null,
  ]);
}

export function lineKey(item: BillingItem): string {
  return JSON.stringify([
    item.id, item.projectId, item.description, item.type, item.serviceType ?? null, item.quantity,
    item.unitPrice, item.amount, item.customAmount, item.printCost ?? null, item.markupOverride ?? null,
    item.billingStatus, item.productionStatus, item.invoiceId ?? null, item.note ?? "",
    item.priceReviewStatus ?? null, item.deletedAt ?? null,
    // Imported rows never carry a V5 mode.
    item.finalMode ?? null,
  ]);
}

export interface RecordComparison {
  collection: "clients" | "projects" | "billingItems";
  expected: number;
  found: number;
  missing: string[];
  extra: string[];
  different: string[];
}

function compare<T extends { id: string }>(
  collection: RecordComparison["collection"],
  expected: readonly T[],
  found: readonly T[],
  key: (record: T) => string,
): RecordComparison {
  const want = new Map(expected.map((record) => [record.id, key(record)]));
  const have = new Map(found.map((record) => [record.id, key(record)]));
  return {
    collection,
    expected: want.size,
    found: have.size,
    missing: [...want.keys()].filter((id) => !have.has(id)),
    extra: [...have.keys()].filter((id) => !want.has(id)),
    different: [...want.keys()].filter((id) => have.has(id) && have.get(id) !== want.get(id)),
  };
}

/**
 * V3 (as mapped) against what V5 holds. Pass the records V5 returns; the
 * same visibility filter is applied to both sides (active only, or all).
 */
export function compareImport(
  v3: Pick<Database, "clients" | "projects" | "billingItems">,
  v5: Pick<Database, "clients" | "projects" | "billingItems">,
  { activeOnly }: { activeOnly: boolean },
): RecordComparison[] {
  const live = <T extends { deletedAt?: string | null }>(list: readonly T[]) =>
    activeOnly ? list.filter((record) => !record.deletedAt) : list;
  return [
    compare("clients", v3.clients, v5.clients, clientKey),
    compare("projects", live(v3.projects), live(v5.projects), projectKey),
    compare("billingItems", live(v3.billingItems), live(v5.billingItems), lineKey),
  ];
}

/**
 * Every V3 record is in V5, unchanged. Right after the import nothing else may
 * be there either (`allowExtra: false`); later, records created in V5 itself
 * (new work, TEST data) are expected and only listed.
 */
export function comparisonPasses(results: readonly RecordComparison[], { allowExtra = false } = {}): boolean {
  return results.every((result) => !result.missing.length && (allowExtra || !result.extra.length) && !result.different.length);
}

/** Business data present in V5 — an import only goes into a V5 without any. */
export function hasBusinessData(db: Partial<Database>): boolean {
  return (
    (db.clients?.length ?? 0) > 0 ||
    (db.projects?.length ?? 0) > 0 ||
    (db.billingItems?.length ?? 0) > 0 ||
    (db.invoices?.length ?? 0) > 0 ||
    (db.taxInvoices?.length ?? 0) > 0 ||
    (db.projectPayments?.length ?? 0) > 0
  );
}
