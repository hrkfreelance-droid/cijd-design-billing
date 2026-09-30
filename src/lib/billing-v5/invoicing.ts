/**
 * Invoice management operations over the V5 database.
 *
 * Each function changes `db` in place and runs inside one Store transaction,
 * which commits all-or-nothing under D1's optimistic version lock. That lock is
 * what makes double billing impossible: two invoices racing for the same
 * billing money cannot both commit, and the retry sees the first one.
 *
 * Invoice rules:
 *   identity, number, existence   immutable (no delete; cancel keeps the record)
 *   content                       editable; each change keeps the previous version
 *   exchange rate                 follows the invoice date only when the date changes
 */
import { RuleError } from "../data/repository";
import type {
  BillingAllocation,
  Customer,
  Database,
  Invoice,
  InvoiceDiscount,
  InvoicePayment,
  InvoiceRevision,
  Product,
  TaxInvoiceLine,
  TaxInvoiceRecord,
} from "../types";
import { DiscountPolicyUnresolvedError, invoiceTotals, nextCode, nextTaxInvoiceNumber, roundMoney, toCents } from "./calculation";
import { billingState, customerFor, invoiceCollection, officialRateForDate, readyProjectIds } from "./ontology";

const newId = () => globalThis.crypto.randomUUID();
const now = () => new Date().toISOString();
/** Enough for a long invoice; the PDF flows onto more pages beyond 10 lines. */
export const MAX_INVOICE_ITEMS = 40;

type CustomerFields = Pick<
  Customer,
  "companyNameEn" | "companyNameKm" | "addressEn" | "addressKm" | "telephone" | "vatin"
>;

export interface InvoiceItemInput {
  billingItemId?: string | null;
  productId?: string | null;
  description: string;
  quantity: number;
  unit?: string | null;
  unitPrice: number;
  /** For a billing line: the amount billed from it (≤ what is left). Otherwise qty × unit price. */
  amount?: number;
}

export interface RateInput {
  rate: number;
  source: "NBC" | "MANUAL";
  effectiveDate?: string | null;
}

export interface InvoiceInput {
  customerId: string;
  invoiceDate: string;
  customer: Partial<CustomerFields>;
  items: InvoiceItemInput[];
  discount?: InvoiceDiscount | null;
  vatApplicable?: boolean;
  /** Only a MANUAL rate is taken from the caller; NBC comes from the stored history. */
  exchangeRate?: RateInput | null;
  depositUsd?: number;
  note?: string | null;
  /** Also write these customer details to the Customer Master. */
  updateCustomerMaster?: boolean;
  /** Rejected if it differs: an invoice number never changes. */
  invoiceNumber?: string;
  reason?: string | null;
  actor: string;
}

function log(db: Database, actor: string, action: string, entity: string, entityId: string, detail?: string) {
  db.auditLogs.push({ id: newId(), at: now(), actor, action, entity, entityId, detail });
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function money(value: number): number {
  return roundMoney(value);
}

function ensureCollections(db: Database) {
  db.taxInvoices ??= [];
  db.customers ??= [];
  db.products ??= [];
  db.billingAllocations ??= [];
  db.invoicePayments ??= [];
  db.invoiceRevisions ??= [];
}

function customerSnapshot(fields: Partial<CustomerFields>): TaxInvoiceRecord["customer"] {
  return {
    companyNameEn: fields.companyNameEn?.trim() ?? "",
    companyNameKm: fields.companyNameKm?.trim() ?? "",
    addressEn: fields.addressEn?.trim() ?? "",
    addressKm: fields.addressKm?.trim() ?? "",
    telephone: fields.telephone?.trim() ?? "",
    vatin: fields.vatin?.trim() ?? "",
  };
}

/* --------------------------------------------------------------- masters */

export interface CustomerInput extends Partial<Omit<Customer, "id" | "createdAt" | "updatedAt" | "updatedBy">> {
  id?: string;
  /** The short name used on the Billing screens (the client name). */
  name?: string;
  actor: string;
}

export function saveCustomer(db: Database, input: CustomerInput): Customer {
  ensureCollections(db);
  const at = now();
  let client = input.id ? db.clients.find((entry) => entry.id === input.id) : undefined;
  if (input.id && !client) throw new RuleError("NOT_FOUND", "Customer was not found.", 404);
  const name = (input.name ?? input.companyNameEn ?? "").trim();
  if (!client) {
    if (!name) throw new RuleError("INVALID", "Enter the customer name.", 400);
    if (db.clients.some((entry) => entry.name.toLowerCase() === name.toLowerCase())) {
      throw new RuleError("DUPLICATE_CLIENT", `${name} already exists.`);
    }
    client = { id: newId(), name, active: true, createdAt: at };
    db.clients.push(client);
  } else if (input.name !== undefined && name && name !== client.name) {
    if (db.clients.some((entry) => entry.id !== client!.id && entry.name.toLowerCase() === name.toLowerCase())) {
      throw new RuleError("DUPLICATE_CLIENT", `${name} already exists.`);
    }
    client.name = name;
  }
  const base = customerFor(db as never, client.id);
  const existing = db.customers!.find((entry) => entry.id === client!.id);
  const code = (input.customerCode ?? existing?.customerCode ?? "").trim() ||
    nextCode("C", db.customers!.map((entry) => entry.customerCode));
  if (db.customers!.some((entry) => entry.id !== client!.id && entry.customerCode.toLowerCase() === code.toLowerCase())) {
    throw new RuleError("DUPLICATE_CODE", `Customer code ${code} is already used.`);
  }
  const pick = (key: keyof CustomerFields | "contactPerson" | "email") =>
    ((input[key] as string | undefined) ?? (existing?.[key] as string | undefined) ?? (base[key] as string)).trim();
  const next: Customer = {
    id: client.id,
    customerCode: code,
    companyNameEn: pick("companyNameEn") || client.name,
    companyNameKm: pick("companyNameKm"),
    addressEn: pick("addressEn"),
    addressKm: pick("addressKm"),
    telephone: pick("telephone"),
    vatin: pick("vatin"),
    contactPerson: pick("contactPerson"),
    email: pick("email"),
    active: input.active ?? existing?.active ?? client.active,
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
    updatedBy: input.actor,
  };
  client.active = next.active;
  if (existing) Object.assign(existing, next);
  else db.customers!.push(next);
  log(db, input.actor, existing ? "customer.update" : "customer.create", "customer", next.id, next.customerCode);
  return next;
}

export interface ProductInput extends Partial<Omit<Product, "id" | "createdAt" | "updatedAt" | "updatedBy">> {
  id?: string;
  actor: string;
}

export function saveProduct(db: Database, input: ProductInput): Product {
  ensureCollections(db);
  const at = now();
  const existing = input.id ? db.products!.find((entry) => entry.id === input.id) : undefined;
  if (input.id && !existing) throw new RuleError("NOT_FOUND", "Product was not found.", 404);
  const description = (input.description ?? existing?.description ?? "").trim();
  if (!description) throw new RuleError("INVALID", "Enter a description.", 400);
  if (db.products!.some((entry) => entry.id !== existing?.id && entry.active && entry.description.toLowerCase() === description.toLowerCase())) {
    throw new RuleError("DUPLICATE_PRODUCT", `"${description}" is already in the product list.`);
  }
  const price = input.defaultUnitPrice === undefined ? (existing?.defaultUnitPrice ?? null) : input.defaultUnitPrice;
  if (price !== null && (!Number.isFinite(price) || price < 0)) throw new RuleError("INVALID", "Unit price must be zero or more.", 400);
  const code = (input.productCode ?? existing?.productCode ?? "").trim() || nextCode("P", db.products!.map((entry) => entry.productCode));
  if (db.products!.some((entry) => entry.id !== existing?.id && entry.productCode.toLowerCase() === code.toLowerCase())) {
    throw new RuleError("DUPLICATE_CODE", `Product code ${code} is already used.`);
  }
  const next: Product = {
    id: existing?.id ?? newId(),
    productCode: code,
    description,
    defaultUnitPrice: price === null ? null : money(price),
    unit: (input.unit ?? existing?.unit ?? "").trim(),
    active: input.active ?? existing?.active ?? true,
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
    updatedBy: input.actor,
  };
  if (existing) Object.assign(existing, next);
  else db.products!.push(next);
  log(db, input.actor, existing ? "product.update" : "product.create", "product", next.id, next.productCode);
  return next;
}

/* --------------------------------------------------------------- invoices */

interface Prepared {
  lines: TaxInvoiceLine[];
  /** billingItemId → amount billed from it. */
  perBilling: Map<string, number>;
  projectIds: string[];
}

/** Validates the items against the Customer and what each billing line has left. */
function prepareItems(db: Database, input: InvoiceInput, excludeInvoiceId: string | null): Prepared {
  if (!Array.isArray(input.items) || input.items.length === 0) throw new RuleError("NO_ITEMS", "Add at least one line.", 400);
  if (input.items.length > MAX_INVOICE_ITEMS) throw new RuleError("TOO_MANY_LINES", `An invoice holds at most ${MAX_INVOICE_ITEMS} lines.`, 400);
  const ready = readyProjectIds(db as never);
  const lines: TaxInvoiceLine[] = [];
  const perBilling = new Map<string, number>();
  const projectIds: string[] = [];

  for (const raw of input.items) {
    const description = (raw.description ?? "").trim();
    const quantity = Number(raw.quantity);
    const unitPrice = Number(raw.unitPrice);
    if (!description) throw new RuleError("INVALID", "Every line needs a description.", 400);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new RuleError("INVALID", `"${description}": quantity must be more than zero.`, 400);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new RuleError("INVALID", `"${description}": unit price must be zero or more.`, 400);
    const amount = raw.amount === undefined || raw.amount === null ? money(quantity * unitPrice) : money(Number(raw.amount));
    if (!Number.isFinite(amount) || amount < 0) throw new RuleError("INVALID", `"${description}": amount must be zero or more.`, 400);

    let billingItemId: string | null = null;
    if (raw.billingItemId) {
      const item = db.billingItems.find((entry) => entry.id === raw.billingItemId && !entry.deletedAt);
      if (!item) throw new RuleError("NOT_FOUND", `Billing line ${raw.billingItemId} was not found.`, 404);
      const project = db.projects.find((entry) => entry.id === item.projectId && !entry.deletedAt);
      if (!project) throw new RuleError("NOT_FOUND", "That billing line's project was not found.", 404);
      if (project.clientId !== input.customerId) {
        throw new RuleError("DIFFERENT_CUSTOMER", "An invoice can only bill one customer's work.", 400);
      }
      const state = billingState(db as never, item, ready);
      if (state.legacyBilled) throw new RuleError("ALREADY_BILLED", `"${item.description}" was already billed.`);
      if (state.state === "NOT_READY") throw new RuleError("NOT_READY", `"${item.description}" is not ready to bill yet.`, 409);
      billingItemId = item.id;
      perBilling.set(item.id, money((perBilling.get(item.id) ?? 0) + amount));
      if (!projectIds.includes(project.id)) projectIds.push(project.id);
    }
    const product = raw.productId ? db.products?.find((entry) => entry.id === raw.productId) : undefined;
    if (raw.productId && !product) throw new RuleError("NOT_FOUND", "That product was not found.", 404);
    lines.push({
      billingItemId,
      productId: product?.id ?? null,
      productCode: product?.productCode ?? null,
      description,
      quantity,
      unit: raw.unit?.trim() || product?.unit || null,
      unitPrice: money(unitPrice),
      amount,
    });
  }

  // Server-side guard: never bill more of a line than it has left.
  for (const [billingItemId, requested] of perBilling) {
    const item = db.billingItems.find((entry) => entry.id === billingItemId)!;
    const others = (db.billingAllocations ?? []).filter(
      (allocation) => allocation.billingItemId === billingItemId && !allocation.voidedAt && allocation.invoiceId !== excludeInvoiceId,
    );
    const left = toCents(item.amount ?? 0) - others.reduce((sum, allocation) => sum + toCents(allocation.amount), 0);
    if (toCents(requested) > left) {
      throw new RuleError(
        "OVER_ALLOCATION",
        `"${item.description}" has $${(Math.max(left, 0) / 100).toFixed(2)} left to bill; $${requested.toFixed(2)} was requested.`,
        409,
      );
    }
    if (toCents(requested) === 0) throw new RuleError("INVALID", `"${item.description}": bill more than $0.00 or remove the line.`, 400);
  }
  return { lines, perBilling, projectIds };
}

function checkDiscountAndDeposit(input: InvoiceInput) {
  const deposit = input.depositUsd ?? 0;
  if (!Number.isFinite(deposit) || deposit < 0) throw new RuleError("INVALID", "The deposit must be zero or more.", 400);
  const discount = input.discount;
  if (!discount) return;
  if (!Number.isFinite(discount.value) || discount.value < 0) throw new RuleError("INVALID", "The discount must be zero or more.", 400);
  if (discount.type === "PERCENT" && discount.value > 100) throw new RuleError("INVALID", "A discount cannot be more than 100%.", 400);
}

/**
 * Invoice totals, with the discount/VAT order left to `DISCOUNT_VAT_POLICY`.
 * While that policy is unresolved an invoice with a discount is refused.
 */
function totalsFor(input: InvoiceInput, lines: readonly { amount: number }[], exchangeRate: number) {
  let totals;
  try {
    totals = invoiceTotals({ lines, discount: input.discount, vatApplicable: input.vatApplicable !== false, exchangeRate, deposit: input.depositUsd });
  } catch (error) {
    if (error instanceof DiscountPolicyUnresolvedError) throw new RuleError(error.code, error.message, 409);
    throw error;
  }
  if (input.discount?.type === "FIXED" && toCents(input.discount.value) > toCents(totals.discountUsd)) {
    throw new RuleError("INVALID", "The discount is more than the amount it applies to.", 400);
  }
  return totals;
}

type ResolvedRate = { rate: number; source: "NBC" | "MANUAL"; effectiveDate: string | null; basis: "EXACT" | "IN_EFFECT" | "MANUAL"; forDate: string };

/**
 * The rate for the invoice date (see `officialRateForDate`). A MANUAL rate is
 * accepted only when no NBC rate can be established for that date; it is
 * saved with the invoice date it was entered for.
 */
function resolveRate(db: Database, date: string, provided: RateInput | null | undefined): ResolvedRate {
  const official = officialRateForDate(db.exchangeRates, date);
  if (provided?.source === "MANUAL") {
    if (official) {
      throw new RuleError("RATE_AVAILABLE", `The NBC rate for ${date} is ${official.rate.rate}. A rate is entered by hand only when NBC has none.`, 409);
    }
    const rate = Number(provided.rate);
    if (!Number.isFinite(rate) || rate <= 0) throw new RuleError("INVALID", "Enter the exchange rate.", 400);
    return { rate, source: "MANUAL", effectiveDate: null, basis: "MANUAL", forDate: date };
  }
  if (!official) {
    throw new RuleError("RATE_REQUIRED", `No NBC rate can be established for ${date}. Enter the rate by hand.`, 409);
  }
  return { rate: official.rate.rate, source: "NBC", effectiveDate: official.rate.effectiveDate, basis: official.basis, forDate: date };
}

function syncAllocations(db: Database, invoiceId: string, perBilling: Map<string, number>, actor: string) {
  const at = now();
  const before = (db.billingAllocations ?? []).filter((allocation) => allocation.invoiceId === invoiceId && !allocation.voidedAt);
  const unchanged = before.length === perBilling.size && before.every((allocation) => perBilling.get(allocation.billingItemId) === allocation.amount);
  if (unchanged) return;
  for (const allocation of before) {
    allocation.voidedAt = at;
    allocation.voidedBy = actor;
  }
  for (const [billingItemId, amount] of perBilling) {
    const allocation: BillingAllocation = { id: newId(), billingItemId, invoiceId, amount, createdAt: at, createdBy: actor, voidedAt: null, voidedBy: null };
    db.billingAllocations!.push(allocation);
  }
}

/**
 * Billing lines follow their allocations: any valid allocation marks the line
 * INVOICED (locked for price edits); none returns it to Accounting.
 */
function syncBillingStatus(db: Database, billingItemIds: Iterable<string>, ledgerInvoiceId: string | null, actor: string) {
  const at = now();
  for (const id of billingItemIds) {
    const item = db.billingItems.find((entry) => entry.id === id);
    if (!item) continue;
    const valid = (db.billingAllocations ?? []).filter((allocation) => allocation.billingItemId === id && !allocation.voidedAt);
    if (valid.length) {
      if (item.billingStatus !== "INVOICED" && item.billingStatus !== "PAID") item.billingStatus = "INVOICED";
      if (!item.invoiceId && ledgerInvoiceId) item.invoiceId = ledgerInvoiceId;
      if (ledgerInvoiceId && !db.invoiceItems.some((link) => link.invoiceId === ledgerInvoiceId && link.billingItemId === id)) {
        db.invoiceItems.push({ invoiceId: ledgerInvoiceId, billingItemId: id });
      }
    } else {
      if (item.billingStatus === "INVOICED") item.billingStatus = "READY_TO_INVOICE";
      if (item.invoiceId && db.invoices.some((ledger) => ledger.id === item.invoiceId && ledger.status !== "PAID")) item.invoiceId = null;
      db.invoiceItems = db.invoiceItems.filter((link) => !(link.billingItemId === id && link.invoiceId === ledgerInvoiceId));
    }
    item.updatedAt = at;
    item.updatedBy = actor;
  }
}

/** The deposit shown on an invoice is its DEPOSIT payments; editing it voids and re-records. */
function syncDeposit(db: Database, invoice: TaxInvoiceRecord, deposit: number, actor: string) {
  const current = (db.invoicePayments ?? []).filter((p) => p.invoiceId === invoice.id && p.kind === "DEPOSIT" && !p.voidedAt);
  const currentCents = current.reduce((sum, p) => sum + toCents(p.amount), 0);
  if (currentCents === toCents(deposit)) return;
  const at = now();
  for (const payment of current) {
    payment.voidedAt = at;
    payment.voidedBy = actor;
    payment.voidReason = "Deposit changed on the invoice";
  }
  if (deposit > 0) {
    db.invoicePayments!.push({
      id: newId(), invoiceId: invoice.id, kind: "DEPOSIT", amount: money(deposit), paidOn: invoice.invoiceDate,
      note: "Deposit", createdAt: at, createdBy: actor, voidedAt: null, voidedBy: null, voidReason: null,
    });
  }
}

function recordRevision(db: Database, invoice: TaxInvoiceRecord, action: InvoiceRevision["action"], previous: TaxInvoiceRecord | null, actor: string, reason: string | null) {
  db.invoiceRevisions!.push({
    id: `rev:${invoice.id}:${invoice.revision ?? 1}:${action}`,
    invoiceId: invoice.id,
    revision: invoice.revision ?? 1,
    action,
    changedAt: now(),
    changedBy: actor,
    reason,
    previousSnapshot: previous ? (JSON.parse(JSON.stringify(previous)) as TaxInvoiceRecord) : null,
  });
}

function upsertCustomerMaster(db: Database, customerId: string, fields: TaxInvoiceRecord["customer"], actor: string) {
  const stored = db.customers!.find((entry) => entry.id === customerId);
  const same = stored && (Object.keys(fields) as (keyof typeof fields)[]).every((key) => stored[key] === fields[key]);
  if (!same) saveCustomer(db, { id: customerId, ...fields, actor });
}

/**
 * Clients named "TEST …" are test records. Their invoices are numbered in a
 * separate TEST-CIJDTI series, so testing on the live V5 never uses up (or
 * leaves gaps in) the real CIJDTI sequence.
 */
export function isTestCustomer(name: string): boolean {
  return /^TEST\b/i.test(name.trim());
}

export const TEST_NUMBER_PREFIX = "TEST-";

function nextInvoiceNumber(db: Database, year: number, test: boolean): string {
  const numbers = db.taxInvoices!.map((invoice) => invoice.invoiceNumber);
  if (!test) return nextTaxInvoiceNumber(year, numbers);
  const testNumbers = numbers.filter((n) => n.startsWith(TEST_NUMBER_PREFIX)).map((n) => n.slice(TEST_NUMBER_PREFIX.length));
  const prefix = `CIJDTI${year}`;
  const max = testNumbers.filter((n) => n.startsWith(prefix)).reduce((m, n) => Math.max(m, Number(n.slice(prefix.length)) || 0), 0);
  return `${TEST_NUMBER_PREFIX}${prefix}${String(max + 1).padStart(3, "0")}`;
}

export function issueInvoice(db: Database, input: InvoiceInput): TaxInvoiceRecord {
  ensureCollections(db);
  const client = db.clients.find((entry) => entry.id === input.customerId);
  if (!client) throw new RuleError("NOT_FOUND", "Choose a customer.", 404);
  if (!isIsoDate(input.invoiceDate)) throw new RuleError("INVALID", "Enter a valid invoice date.", 400);
  const customer = customerSnapshot(input.customer);
  if (!customer.companyNameEn && !customer.companyNameKm) throw new RuleError("INVALID", "Enter the customer's legal name.", 400);
  const { lines, perBilling, projectIds } = prepareItems(db, input, null);
  checkDiscountAndDeposit(input);
  const rate = resolveRate(db, input.invoiceDate, input.exchangeRate);
  const totals = totalsFor(input, lines, rate.rate);
  if (input.depositUsd && toCents(input.depositUsd) > toCents(totals.totalUsd)) {
    throw new RuleError("INVALID", "The deposit is more than the invoice total.", 400);
  }

  // The number is the system's: next in the invoice-date year, after every
  // number ever used (cancelled ones included). Unique under the D1 lock and
  // the archive's UNIQUE(invoice_number).
  const year = Number(input.invoiceDate.slice(0, 4));
  const invoiceNumber = nextInvoiceNumber(db, year, isTestCustomer(client.name));
  const at = now();
  const id = newId();

  let ledgerInvoiceId = "";
  if (perBilling.size) {
    const ledger: Invoice = {
      id: newId(), clientId: client.id, invoiceNumber, invoiceDate: input.invoiceDate,
      amount: money([...perBilling.values()].reduce((sum, value) => sum + value, 0)),
      exchangeRate: rate.rate, exchangeRateSource: rate.source, exchangeRateEffectiveDate: rate.effectiveDate, exchangeRateFetchedAt: null,
      status: "ISSUED", paymentDate: null, paymentSlip: null, receiptStatus: "PENDING",
      createdAt: at, createdBy: input.actor, updatedAt: at, updatedBy: input.actor,
    };
    db.invoices.push(ledger);
    ledgerInvoiceId = ledger.id;
  }
  const projects = projectIds.map((pid) => db.projects.find((entry) => entry.id === pid)!);
  const record: TaxInvoiceRecord = {
    id,
    projectId: projectIds[0] ?? "",
    projectIds,
    clientId: client.id,
    ledgerInvoiceId,
    invoiceNumber,
    invoiceDate: input.invoiceDate,
    status: "ISSUED",
    customer,
    project: { name: projects.map((p) => p.name).join(" · "), note: projects.map((p) => p.note ?? "").filter(Boolean).join("\n") },
    lines,
    vatApplicable: input.vatApplicable !== false,
    vatPercent: totals.vatPercent,
    subtotalUsd: totals.subtotalUsd,
    discount: totals.discountUsd > 0 ? input.discount ?? null : null,
    discountUsd: totals.discountUsd,
    discountPolicy: totals.discountPolicy,
    taxableUsd: totals.taxableUsd,
    vatUsd: totals.vatUsd,
    totalUsd: totals.totalUsd,
    exchangeRate: rate.rate,
    exchangeRateSource: rate.source,
    exchangeRateEffectiveDate: rate.effectiveDate,
    exchangeRateBasis: rate.basis,
    exchangeRateForDate: rate.forDate,
    totalKhr: totals.totalKhr,
    depositUsd: totals.depositUsd,
    issuedAt: at,
    issuedBy: input.actor,
    revision: 1,
    updatedAt: at,
    updatedBy: input.actor,
    note: input.note?.trim() || null,
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: null,
  };
  db.taxInvoices!.push(record);
  syncAllocations(db, id, perBilling, input.actor);
  syncBillingStatus(db, perBilling.keys(), ledgerInvoiceId || null, input.actor);
  syncDeposit(db, record, totals.depositUsd, input.actor);
  if (input.updateCustomerMaster !== false) upsertCustomerMaster(db, client.id, customer, input.actor);
  recordRevision(db, record, "ISSUE", null, input.actor, null);
  log(db, input.actor, "tax_invoice.issue", "tax_invoice", id, `${invoiceNumber} ${totals.totalUsd}`);
  return record;
}

export function editInvoice(db: Database, invoiceId: string, input: InvoiceInput): TaxInvoiceRecord {
  ensureCollections(db);
  const record = db.taxInvoices!.find((entry) => entry.id === invoiceId);
  if (!record) throw new RuleError("NOT_FOUND", "Tax invoice was not found.", 404);
  if (record.status !== "ISSUED") throw new RuleError("INVOICE_CANCELLED", "A cancelled invoice cannot be edited.");
  if (input.invoiceNumber !== undefined && input.invoiceNumber !== record.invoiceNumber) {
    throw new RuleError("NUMBER_IMMUTABLE", "An invoice number never changes.", 400);
  }
  if (input.customerId !== record.clientId) throw new RuleError("DIFFERENT_CUSTOMER", "An invoice keeps its customer.", 400);
  if (!isIsoDate(input.invoiceDate)) throw new RuleError("INVALID", "Enter a valid invoice date.", 400);
  const customer = customerSnapshot(input.customer);
  if (!customer.companyNameEn && !customer.companyNameKm) throw new RuleError("INVALID", "Enter the customer's legal name.", 400);

  const previous = JSON.parse(JSON.stringify(record)) as TaxInvoiceRecord;
  const { lines, perBilling, projectIds } = prepareItems(db, input, record.id);
  // The rate belongs to the invoice date: kept as saved unless the date changes.
  checkDiscountAndDeposit(input);
  const rate = input.invoiceDate === record.invoiceDate
    ? { rate: record.exchangeRate, source: record.exchangeRateSource, effectiveDate: record.exchangeRateEffectiveDate, basis: record.exchangeRateBasis, forDate: record.exchangeRateForDate }
    : resolveRate(db, input.invoiceDate, input.exchangeRate);
  const totals = totalsFor(input, lines, rate.rate);
  if (input.depositUsd && toCents(input.depositUsd) > toCents(totals.totalUsd)) {
    throw new RuleError("INVALID", "The deposit is more than the invoice total.", 400);
  }
  const others = (db.invoicePayments ?? []).filter((p) => p.invoiceId === record.id && p.kind === "PAYMENT" && !p.voidedAt);
  const paidCents = others.reduce((sum, p) => sum + toCents(p.amount), 0) + toCents(totals.depositUsd);
  if (paidCents > toCents(totals.totalUsd)) {
    throw new RuleError("OVERPAID", "Payments already received are more than the new total. Void a payment first.", 409);
  }

  const released = new Set((db.billingAllocations ?? []).filter((a) => a.invoiceId === record.id && !a.voidedAt).map((a) => a.billingItemId));
  const projects = projectIds.map((pid) => db.projects.find((entry) => entry.id === pid)!);
  Object.assign(record, {
    projectId: projectIds[0] ?? record.projectId,
    projectIds,
    invoiceDate: input.invoiceDate,
    customer,
    project: projectIds.length ? { name: projects.map((p) => p.name).join(" · "), note: projects.map((p) => p.note ?? "").filter(Boolean).join("\n") } : record.project,
    lines,
    vatApplicable: input.vatApplicable !== false,
    vatPercent: totals.vatPercent,
    subtotalUsd: totals.subtotalUsd,
    discount: totals.discountUsd > 0 ? input.discount ?? null : null,
    discountUsd: totals.discountUsd,
    discountPolicy: totals.discountPolicy,
    taxableUsd: totals.taxableUsd,
    vatUsd: totals.vatUsd,
    totalUsd: totals.totalUsd,
    exchangeRate: rate.rate,
    exchangeRateSource: rate.source,
    exchangeRateEffectiveDate: rate.effectiveDate,
    exchangeRateBasis: rate.basis,
    exchangeRateForDate: rate.forDate,
    totalKhr: totals.totalKhr,
    depositUsd: totals.depositUsd,
    revision: (record.revision ?? 1) + 1,
    updatedAt: now(),
    updatedBy: input.actor,
    note: input.note === undefined ? record.note ?? null : input.note?.trim() || null,
  } satisfies Partial<TaxInvoiceRecord>);
  syncAllocations(db, record.id, perBilling, input.actor);
  for (const id of perBilling.keys()) released.add(id);
  syncBillingStatus(db, released, record.ledgerInvoiceId || null, input.actor);
  const ledger = db.invoices.find((entry) => entry.id === record.ledgerInvoiceId);
  if (ledger) {
    ledger.invoiceDate = record.invoiceDate;
    ledger.amount = money([...perBilling.values()].reduce((sum, value) => sum + value, 0));
    ledger.updatedAt = now();
    ledger.updatedBy = input.actor;
  }
  syncDeposit(db, record, totals.depositUsd, input.actor);
  if (input.updateCustomerMaster) upsertCustomerMaster(db, record.clientId, customer, input.actor);
  recordRevision(db, record, "EDIT", previous, input.actor, input.reason?.trim() || null);
  log(db, input.actor, "tax_invoice.edit", "tax_invoice", record.id, `${record.invoiceNumber} rev ${record.revision}`);
  return record;
}

export function cancelInvoice(db: Database, invoiceId: string, reason: string, actor: string): TaxInvoiceRecord {
  ensureCollections(db);
  const record = db.taxInvoices!.find((entry) => entry.id === invoiceId);
  if (!record) throw new RuleError("NOT_FOUND", "Tax invoice was not found.", 404);
  if (record.status !== "ISSUED") throw new RuleError("ALREADY_CANCELLED", "This tax invoice was already cancelled.");
  const trimmed = reason.trim();
  if (!trimmed) throw new RuleError("INVALID", "Enter a reason for cancelling.", 400);
  if ((db.invoicePayments ?? []).some((p) => p.invoiceId === invoiceId && !p.voidedAt)) {
    throw new RuleError("INVOICE_PAID", "This invoice has payments. Void them (or set the deposit to 0) before cancelling.");
  }
  const ledger = db.invoices.find((entry) => entry.id === record.ledgerInvoiceId);
  if (ledger?.status === "PAID") throw new RuleError("INVOICE_PAID", "This invoice is paid. Undo the payment before cancelling it.");
  const previous = JSON.parse(JSON.stringify(record)) as TaxInvoiceRecord;
  const released = new Set((db.billingAllocations ?? []).filter((a) => a.invoiceId === record.id && !a.voidedAt).map((a) => a.billingItemId));
  syncAllocations(db, record.id, new Map(), actor);
  if (ledger && ledger.status !== "VOID") {
    ledger.status = "VOID";
    ledger.receiptStatus = "NOT_REQUIRED";
    ledger.updatedAt = now();
    ledger.updatedBy = actor;
  }
  syncBillingStatus(db, released, record.ledgerInvoiceId || null, actor);
  for (const id of released) {
    const item = db.billingItems.find((entry) => entry.id === id);
    if (item && item.invoiceId === record.ledgerInvoiceId) item.invoiceId = null;
  }
  db.invoiceItems = db.invoiceItems.filter((link) => link.invoiceId !== record.ledgerInvoiceId);
  record.status = "CANCELLED";
  record.cancelledAt = now();
  record.cancelledBy = actor;
  record.cancellationReason = trimmed;
  record.revision = (record.revision ?? 1) + 1;
  record.updatedAt = record.cancelledAt;
  record.updatedBy = actor;
  recordRevision(db, record, "CANCEL", previous, actor, trimmed);
  log(db, actor, "tax_invoice.cancel", "tax_invoice", record.id, `${record.invoiceNumber}: ${trimmed}`);
  return record;
}

/* --------------------------------------------------------------- payments */

export function addInvoicePayment(db: Database, input: { invoiceId: string; amount: number; paidOn?: string; note?: string; actor: string }): InvoicePayment {
  ensureCollections(db);
  const record = db.taxInvoices!.find((entry) => entry.id === input.invoiceId);
  if (!record) throw new RuleError("NOT_FOUND", "Tax invoice was not found.", 404);
  if (record.status !== "ISSUED") throw new RuleError("INVOICE_CANCELLED", "A cancelled invoice takes no payments.");
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new RuleError("INVALID", "A payment must be more than zero.", 400);
  const paidOn = input.paidOn || new Date().toISOString().slice(0, 10);
  if (!isIsoDate(paidOn)) throw new RuleError("INVALID", "Payment date must be a valid date.", 400);
  const state = invoiceCollection(db, record);
  if (toCents(amount) > toCents(state.outstandingUsd)) {
    throw new RuleError("OVERPAYMENT", `Only $${state.outstandingUsd.toFixed(2)} is outstanding.`, 409);
  }
  const payment: InvoicePayment = {
    id: newId(), invoiceId: record.id, kind: "PAYMENT", amount: money(amount), paidOn, note: input.note?.trim() || null,
    createdAt: now(), createdBy: input.actor, voidedAt: null, voidedBy: null, voidReason: null,
  };
  db.invoicePayments!.push(payment);
  log(db, input.actor, "invoice.payment", "tax_invoice", record.id, `${payment.amount} on ${paidOn}`);
  return payment;
}

export function voidInvoicePayment(db: Database, paymentId: string, reason: string, actor: string): InvoicePayment {
  ensureCollections(db);
  const payment = db.invoicePayments!.find((entry) => entry.id === paymentId);
  if (!payment) throw new RuleError("NOT_FOUND", "Payment was not found.", 404);
  if (payment.voidedAt) throw new RuleError("ALREADY_VOID", "This payment was already voided.");
  if (payment.kind === "DEPOSIT") throw new RuleError("USE_EDIT", "Change the deposit by editing the invoice.", 400);
  if (!reason.trim()) throw new RuleError("INVALID", "Enter a reason.", 400);
  payment.voidedAt = now();
  payment.voidedBy = actor;
  payment.voidReason = reason.trim();
  log(db, actor, "invoice.payment.void", "tax_invoice", payment.invoiceId, `${payment.amount}: ${payment.voidReason}`);
  return payment;
}

/* -------------------------------------------------------------- migration */

/**
 * Invoices issued before allocations and revisions existed get them, derived
 * from what they already record. Deterministic ids, so it is idempotent; it
 * adds records and changes none.
 */
export function backfillInvoiceManagement(db: Database): boolean {
  if (db.taxInvoices === undefined) return false;
  ensureCollections(db);
  let changed = false;
  for (const invoice of db.taxInvoices) {
    const hasAllocations = db.billingAllocations!.some((allocation) => allocation.invoiceId === invoice.id);
    if (!hasAllocations) {
      const perBilling = new Map<string, number>();
      for (const line of invoice.lines) {
        if (line.billingItemId) perBilling.set(line.billingItemId, money((perBilling.get(line.billingItemId) ?? 0) + line.amount));
      }
      for (const [billingItemId, amount] of perBilling) {
        db.billingAllocations!.push({
          id: `alloc:${invoice.id}:${billingItemId}`,
          billingItemId,
          invoiceId: invoice.id,
          amount,
          createdAt: invoice.issuedAt,
          createdBy: invoice.issuedBy,
          voidedAt: invoice.status === "CANCELLED" ? (invoice.cancelledAt ?? invoice.issuedAt) : null,
          voidedBy: invoice.status === "CANCELLED" ? (invoice.cancelledBy ?? null) : null,
        });
        changed = true;
      }
    }
    if (!db.invoiceRevisions!.some((revision) => revision.invoiceId === invoice.id)) {
      db.invoiceRevisions!.push({
        id: `rev:${invoice.id}:1:ISSUE`, invoiceId: invoice.id, revision: 1, action: "ISSUE",
        changedAt: invoice.issuedAt, changedBy: invoice.issuedBy, reason: null, previousSnapshot: null,
      });
      changed = true;
    }
  }
  return changed;
}
