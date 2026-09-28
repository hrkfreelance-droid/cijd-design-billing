import { calculateBillingLine } from "@/domain/pricing";
import { VAT_PERCENT } from "@/domain/invoice";
import type {
  BillingItem,
  BootstrapData,
  Customer,
  ExchangeRate,
  InvoiceLine,
  Project,
  TaxInvoice,
} from "@/domain/types";
import type { D1Database, D1PreparedStatement, D1Result, D1Value } from "@/server/d1-types";

type Row = Record<string, unknown>;
type BillingInput = Omit<BillingItem, "id" | "createdAt" | "updatedAt" | "invoicedAt"> & { id?: string };
type ProjectInput = { customerId: string; code: string; title: string; depositUsd: number };

export class RepositoryError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "RepositoryError";
  }
}

const now = () => new Date().toISOString();
const uuid = () => globalThis.crypto.randomUUID();
const asText = (value: unknown) => String(value ?? "");
const asNumber = (value: unknown) => Number(value ?? 0);
const asNullableNumber = (value: unknown) => (value == null ? null : Number(value));
const money = (cents: number | null) => (cents == null ? null : cents / 100);
const QUANTITY_SCALE = 10_000;
const COST_SCALE = 10_000;
const RATE_SCALE = 10_000;

function integer(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) throw new RepositoryError(`${label} is outside the supported range`);
  return value;
}

function toCents(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RepositoryError(`${label} must be a non-negative number`);
  return integer(Math.round((value + Number.EPSILON) * 100), label);
}

function scaled(value: number, scale: number, label: string, minimum = 0): number {
  if (!Number.isFinite(value) || value < minimum) throw new RepositoryError(`${label} is invalid`);
  return integer(Math.round((value + Number.EPSILON) * scale), label);
}

function divideRounded(numerator: bigint, denominator: bigint): number {
  return Number((numerator + denominator / 2n) / denominator);
}

function amountCents(unitCents: number, quantityUnits: number): number {
  return divideRounded(BigInt(unitCents) * BigInt(quantityUnits), BigInt(QUANTITY_SCALE));
}

function vatCents(subtotalCents: number): number {
  return divideRounded(BigInt(subtotalCents) * BigInt(VAT_PERCENT), 100n);
}

function khrTotal(totalCents: number, rateScaled: number): number {
  return divideRounded(BigInt(totalCents) * BigInt(rateScaled), 1_000_000n);
}

function isoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function rows<T extends Row = Row>(result: D1Result<T>): T[] {
  if (!result.success) throw new RepositoryError(result.error ?? "D1 query failed", 500);
  return result.results;
}

async function all<T extends Row = Row>(db: D1Database, sql: string, ...values: D1Value[]): Promise<T[]> {
  return rows(await db.prepare(sql).bind(...values).all<T>());
}

async function first<T extends Row = Row>(db: D1Database, sql: string, ...values: D1Value[]): Promise<T | null> {
  const result = await db.prepare(sql).bind(...values).first<T>();
  return result;
}

async function run(db: D1Database, sql: string, ...values: D1Value[]): Promise<D1Result> {
  const result = await db.prepare(sql).bind(...values).run();
  if (!result.success) throw new RepositoryError(result.error ?? "D1 write failed", 500);
  return result;
}

async function batch(db: D1Database, statements: D1PreparedStatement[]): Promise<D1Result[]> {
  const result = await db.batch(statements);
  if (result.some((statement) => !statement.success)) {
    throw new RepositoryError(result.find((statement) => !statement.success)?.error ?? "D1 transaction failed", 500);
  }
  return result;
}

function auditStatement(
  db: D1Database,
  action: string,
  entity: string,
  entityId: string | null,
  detail: Record<string, unknown>,
  at = now(),
) {
  return db.prepare(
    "INSERT INTO audit_logs (id, actor, action, entity, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(uuid(), "preview-user", action, entity, entityId, JSON.stringify(detail), at);
}

function mapCustomer(row: Row): Customer {
  return {
    id: asText(row.id),
    companyNameEn: asText(row.company_name_en),
    companyNameKm: asText(row.company_name_km),
    contactName: asText(row.contact_name),
    addressEn: asText(row.address_en),
    addressKm: asText(row.address_km),
    telephone: asText(row.telephone),
    vatin: asText(row.vatin),
    createdAt: asText(row.created_at),
    updatedAt: asText(row.updated_at),
  };
}

function mapProject(row: Row): Project {
  return {
    id: asText(row.id),
    customerId: asText(row.customer_id),
    code: asText(row.code),
    title: asText(row.title),
    depositUsd: asNumber(money(asNumber(row.deposit_cents))),
    createdAt: asText(row.created_at),
    updatedAt: asText(row.updated_at),
  };
}

function mapBillingItem(row: Row): BillingItem {
  return {
    id: asText(row.id),
    projectId: asText(row.project_id),
    serviceType: asText(row.service_type),
    description: asText(row.description),
    quantity: asNumber(row.quantity_units) / QUANTITY_SCALE,
    unitCostUsd: row.unit_cost_ticks == null ? null : asNumber(row.unit_cost_ticks) / COST_SCALE,
    totalCostUsd: money(asNullableNumber(row.total_cost_cents)),
    markupOverridePercent: row.markup_override_hundredths == null ? null : asNumber(row.markup_override_hundredths) / 100,
    recommendedTotalUsd: money(asNullableNumber(row.recommended_total_cents)),
    finalUnitUsd: asNumber(row.final_unit_cents) / 100,
    finalTotalUsd: asNumber(row.final_total_cents) / 100,
    finalMode: row.final_mode as BillingItem["finalMode"],
    readiness: row.readiness as BillingItem["readiness"],
    invoicedAt: row.invoiced_at == null ? null : asText(row.invoiced_at),
    createdAt: asText(row.created_at),
    updatedAt: asText(row.updated_at),
  };
}

function mapLine(row: Row): InvoiceLine {
  return {
    id: asText(row.id),
    invoiceId: asText(row.invoice_id),
    billingItemId: row.billing_item_id == null ? "" : asText(row.billing_item_id),
    description: asText(row.description),
    quantity: asNumber(row.quantity_units) / QUANTITY_SCALE,
    finalUnitUsd: asNumber(row.unit_price_cents) / 100,
    amountUsd: asNumber(row.amount_cents) / 100,
    sortOrder: asNumber(row.sort_order),
  };
}

function mapInvoice(row: Row, lines: InvoiceLine[] = []): TaxInvoice {
  return {
    id: asText(row.id),
    projectId: asText(row.project_id),
    customerId: asText(row.customer_id),
    status: row.status as TaxInvoice["status"],
    invoiceNumber: row.invoice_number == null ? null : asText(row.invoice_number),
    invoiceDate: asText(row.invoice_date),
    customerSnapshot: {
      companyNameEn: asText(row.customer_name_en),
      companyNameKm: asText(row.customer_name_km),
      contactName: asText(row.customer_contact_name),
      addressEn: asText(row.customer_address_en),
      addressKm: asText(row.customer_address_km),
      telephone: asText(row.customer_phone),
      vatin: asText(row.customer_vatin),
    },
    exchangeRateKhr: row.exchange_rate_scaled == null ? null : asNumber(row.exchange_rate_scaled) / RATE_SCALE,
    exchangeRateSource: row.exchange_rate_source == null ? null : asText(row.exchange_rate_source),
    exchangeRateEffectiveDate: row.exchange_rate_date == null ? null : asText(row.exchange_rate_date),
    subtotalUsd: asNumber(row.subtotal_cents) / 100,
    vatPercent: asNumber(row.vat_rate_basis_points ?? 1000) / 100,
    vatUsd: asNumber(row.vat_cents) / 100,
    totalUsd: asNumber(row.usd_total_cents) / 100,
    totalKhr: asNullableNumber(row.khr_total),
    issuedAt: row.issued_at == null ? null : asText(row.issued_at),
    cancelledAt: row.cancelled_at == null ? null : asText(row.cancelled_at),
    cancellationReason: row.cancellation_reason == null ? null : asText(row.cancellation_reason),
    createdAt: asText(row.created_at),
    updatedAt: asText(row.updated_at),
    lines,
  };
}

function mapRate(row: Row): ExchangeRate {
  return {
    id: asText(row.id),
    rateKhrPerUsd: asNumber(row.rate_scaled) / RATE_SCALE,
    source: asText(row.source),
    effectiveDate: asText(row.effective_date),
    fetchedAt: asText(row.fetched_at),
  };
}

function customerValues(input: Partial<Customer>) {
  return [
    input.companyNameEn ?? "",
    input.companyNameKm ?? "",
    input.contactName ?? "",
    input.addressEn ?? "",
    input.addressKm ?? "",
    input.telephone ?? "",
    input.vatin ?? "",
  ];
}

async function invoiceRow(db: D1Database, id: string): Promise<Row> {
  const row = await first(db, "SELECT * FROM tax_invoices WHERE id = ?", id);
  if (!row) throw new RepositoryError("Invoice not found", 404);
  return row;
}

async function invoiceWithLines(db: D1Database, id: string): Promise<TaxInvoice> {
  const invoice = await invoiceRow(db, id);
  const lineRows = await all(db, "SELECT * FROM tax_invoice_lines WHERE invoice_id = ? ORDER BY sort_order", id);
  return mapInvoice(invoice, lineRows.map(mapLine));
}

function isInvoiceNumberCollision(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed: (?:main\.)?tax_invoices\.invoice_number/i.test(message);
}

function lineTotals(lineRows: readonly { unit_price_cents: unknown; quantity_units: unknown }[]) {
  const subtotalCents = lineRows.reduce(
    (sum, line) => sum + amountCents(asNumber(line.unit_price_cents), asNumber(line.quantity_units)),
    0,
  );
  integer(subtotalCents, "Invoice subtotal");
  const taxCents = vatCents(subtotalCents);
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

export function createD1Repository(db: D1Database) {
  async function latestRate(): Promise<ExchangeRate | null> {
    const row = await first(db, "SELECT * FROM exchange_rates ORDER BY effective_date DESC, fetched_at DESC LIMIT 1");
    return row ? mapRate(row) : null;
  }

  return {
    async bootstrap(): Promise<BootstrapData> {
      const [customerRows, projectRows, billingRows, invoiceRows, lineRows, rate] = await Promise.all([
        all(db, "SELECT * FROM customers ORDER BY created_at DESC"),
        all(db, "SELECT * FROM projects ORDER BY created_at DESC"),
        all(db, "SELECT * FROM billing_items ORDER BY created_at ASC"),
        all(db, "SELECT * FROM tax_invoices ORDER BY created_at DESC"),
        all(db, "SELECT * FROM tax_invoice_lines ORDER BY invoice_id, sort_order"),
        latestRate(),
      ]);
      const byInvoice = new Map<string, InvoiceLine[]>();
      for (const row of lineRows) {
        const line = mapLine(row);
        const invoiceLines = byInvoice.get(line.invoiceId) ?? [];
        invoiceLines.push(line);
        byInvoice.set(line.invoiceId, invoiceLines);
      }
      return {
        customers: customerRows.map(mapCustomer),
        projects: projectRows.map(mapProject),
        billingItems: billingRows.map(mapBillingItem),
        invoices: invoiceRows.map((row) => mapInvoice(row, byInvoice.get(asText(row.id)) ?? [])),
        exchangeRate: rate,
      };
    },

    async getInvoice(id: string): Promise<TaxInvoice> {
      return invoiceWithLines(db, id);
    },

    async createCustomer(input: Partial<Customer>): Promise<Customer> {
      const id = uuid();
      const at = now();
      const values = customerValues(input);
      if (!values[0] && !values[1]) throw new RepositoryError("Customer name is required");
      await batch(db, [
        db.prepare("INSERT INTO customers (id, company_name_en, company_name_km, contact_name, address_en, address_km, telephone, vatin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(id, ...values, at, at),
        auditStatement(db, "CREATE", "customer", id, { fields: Object.keys(input) }, at),
      ]);
      const row = await first(db, "SELECT * FROM customers WHERE id = ?", id);
      if (!row) throw new RepositoryError("Customer could not be read after creation", 500);
      return mapCustomer(row);
    },

    async updateCustomer(id: string, input: Partial<Customer>): Promise<Customer> {
      const values = customerValues(input);
      if (!values[0] && !values[1]) throw new RepositoryError("Customer name is required");
      const at = now();
      const result = await batch(db, [
        db.prepare("UPDATE customers SET company_name_en = ?, company_name_km = ?, contact_name = ?, address_en = ?, address_km = ?, telephone = ?, vatin = ?, updated_at = ? WHERE id = ?")
          .bind(...values, at, id),
        db.prepare("INSERT INTO audit_logs (id, actor, action, entity, entity_id, detail, created_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1")
          .bind(uuid(), "preview-user", "UPDATE", "customer", id, JSON.stringify({ fields: Object.keys(input) }), at),
      ]);
      if (result[0].meta.changes !== 1) throw new RepositoryError("Customer not found", 404);
      const row = await first(db, "SELECT * FROM customers WHERE id = ?", id);
      if (!row) throw new RepositoryError("Customer not found", 404);
      return mapCustomer(row);
    },

    async createProject(input: ProjectInput): Promise<Project> {
      const id = uuid();
      const at = now();
      const deposit = toCents(input.depositUsd, "Deposit");
      if (!input.customerId || !input.code.trim() || !input.title.trim()) throw new RepositoryError("Customer, code, and project title are required");
      await batch(db, [
        db.prepare("INSERT INTO projects (id, customer_id, code, title, status, deposit_cents, created_at, updated_at) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?)")
          .bind(id, input.customerId, input.code.trim(), input.title.trim(), deposit, at, at),
        auditStatement(db, "CREATE", "project", id, { customerId: input.customerId }, at),
      ]);
      const row = await first(db, "SELECT * FROM projects WHERE id = ?", id);
      if (!row) throw new RepositoryError("Project could not be read after creation", 500);
      return mapProject(row);
    },

    async updateProject(id: string, input: ProjectInput): Promise<Project> {
      const at = now();
      const deposit = toCents(input.depositUsd, "Deposit");
      if (!input.customerId || !input.code.trim() || !input.title.trim()) throw new RepositoryError("Customer, code, and project title are required");
      const result = await batch(db, [
        db.prepare("UPDATE projects SET customer_id = ?, code = ?, title = ?, deposit_cents = ?, updated_at = ? WHERE id = ?")
          .bind(input.customerId, input.code.trim(), input.title.trim(), deposit, at, id),
        db.prepare("INSERT INTO audit_logs (id, actor, action, entity, entity_id, detail, created_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1")
          .bind(uuid(), "preview-user", "UPDATE", "project", id, JSON.stringify({ customerId: input.customerId }), at),
      ]);
      if (result[0].meta.changes !== 1) throw new RepositoryError("Project not found", 404);
      const row = await first(db, "SELECT * FROM projects WHERE id = ?", id);
      if (!row) throw new RepositoryError("Project not found", 404);
      return mapProject(row);
    },

    async saveBillingItem(input: BillingInput): Promise<BillingItem> {
      if (input.readiness === "INVOICED") throw new RepositoryError("INVOICED is managed by Tax Invoice Issue");
      if (!input.projectId || !input.description.trim() || !input.serviceType.trim()) throw new RepositoryError("Project, service type, and description are required");
      const quantityUnits = scaled(input.quantity, QUANTITY_SCALE, "Quantity", Number.MIN_VALUE);
      const unitCostTicks = input.unitCostUsd == null ? null : scaled(input.unitCostUsd, COST_SCALE, "Unit cost");
      const markupHundredths = input.markupOverridePercent == null
        ? null
        : scaled(input.markupOverridePercent, 100, "Markup override");
      const calculation = calculateBillingLine({
        quantity: quantityUnits / QUANTITY_SCALE,
        unitCostUsd: unitCostTicks == null ? null : unitCostTicks / COST_SCALE,
        markupOverridePercent: markupHundredths == null ? null : markupHundredths / 100,
        finalMode: input.finalMode,
        currentFinalUnitUsd: input.finalMode === "UNIT" ? input.finalUnitUsd : null,
        currentFinalTotalUsd: input.finalMode === "TOTAL" ? input.finalTotalUsd : null,
      });
      const id = input.id ?? uuid();
      const at = now();
      const totalCostCents = calculation.totalCostUsd == null ? null : toCents(calculation.totalCostUsd, "Total cost");
      const recommendedCents = calculation.recommendedTotalUsd == null ? null : toCents(calculation.recommendedTotalUsd, "Recommended total");
      const finalUnitCents = toCents(calculation.finalUnitUsd, "Final unit price");
      const finalTotalCents = toCents(calculation.finalTotalUsd, "Final total");
      if (input.id) {
        const result = await batch(db, [
          db.prepare("UPDATE billing_items SET project_id = ?, service_type = ?, description = ?, quantity_units = ?, unit_cost_ticks = ?, total_cost_cents = ?, markup_override_hundredths = ?, recommended_total_cents = ?, final_unit_cents = ?, final_total_cents = ?, final_mode = ?, readiness = ?, updated_at = ? WHERE id = ?")
            .bind(input.projectId, input.serviceType.trim(), input.description.trim(), quantityUnits, unitCostTicks, totalCostCents, markupHundredths, recommendedCents, finalUnitCents, finalTotalCents, input.finalMode, input.readiness, at, id),
          db.prepare("INSERT INTO audit_logs (id, actor, action, entity, entity_id, detail, created_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1")
            .bind(uuid(), "preview-user", "UPDATE", "billing_item", id, JSON.stringify({ fields: ["pricing", "readiness"] }), at),
        ]);
        if (result[0].meta.changes !== 1) throw new RepositoryError("Billing item not found", 404);
      } else {
        await batch(db, [
          db.prepare("INSERT INTO billing_items (id, project_id, service_type, description, quantity_units, unit_cost_ticks, total_cost_cents, markup_override_hundredths, recommended_total_cents, final_unit_cents, final_total_cents, final_mode, readiness, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(id, input.projectId, input.serviceType.trim(), input.description.trim(), quantityUnits, unitCostTicks, totalCostCents, markupHundredths, recommendedCents, finalUnitCents, finalTotalCents, input.finalMode, input.readiness, at, at),
          auditStatement(db, "CREATE", "billing_item", id, { projectId: input.projectId, readiness: input.readiness }, at),
        ]);
      }
      const row = await first(db, "SELECT * FROM billing_items WHERE id = ?", id);
      if (!row) throw new RepositoryError("Billing item could not be read after save", 500);
      return mapBillingItem(row);
    },

    async createDraft(input: { projectId: string; invoiceDate: string; billingItemIds: string[] }): Promise<TaxInvoice> {
      const itemIds = [...new Set(input.billingItemIds)];
      if (!input.projectId || !itemIds.length) throw new RepositoryError("At least one READY billing item is required");
      if (itemIds.length > 10) throw new RepositoryError("The Excel tax invoice layout supports at most 10 billing lines");
      if (itemIds.length !== input.billingItemIds.length) throw new RepositoryError("Duplicate billing items are not allowed");
      if (!isoDate(input.invoiceDate)) throw new RepositoryError("Invoice date must be a valid ISO date");
      const project = await first(db, "SELECT * FROM projects WHERE id = ?", input.projectId);
      if (!project) throw new RepositoryError("Project not found", 404);
      const customer = await first(db, "SELECT * FROM customers WHERE id = ?", asText(project.customer_id));
      if (!customer) throw new RepositoryError("Customer not found", 404);
      const placeholders = itemIds.map(() => "?").join(", ");
      const itemRows = await all(db,
        `SELECT * FROM billing_items WHERE project_id = ? AND readiness = 'READY' AND id IN (${placeholders}) ORDER BY created_at, id`,
        input.projectId, ...itemIds,
      );
      if (itemRows.length !== itemIds.length) throw new RepositoryError("Every selected billing item must belong to the project and be READY");
      const claimRows = await all(db, `SELECT billing_item_id FROM billing_item_claims WHERE billing_item_id IN (${placeholders})`, ...itemIds);
      if (claimRows.length) throw new RepositoryError("A selected billing item is already part of an issued invoice");
      const id = uuid();
      const at = now();
      const lineValues = itemRows.map((item) => ({
        id: uuid(),
        billingItemId: asText(item.id),
        description: asText(item.description),
        quantityUnits: asNumber(item.quantity_units),
        unitPriceCents: asNumber(item.final_unit_cents),
      }));
      const totals = lineTotals(lineValues.map((line) => ({
        unit_price_cents: line.unitPriceCents,
        quantity_units: line.quantityUnits,
      })));
      const statements: D1PreparedStatement[] = [
        db.prepare("INSERT INTO tax_invoices (id, project_id, customer_id, status, invoice_date, customer_name_en, customer_name_km, customer_contact_name, customer_address_en, customer_address_km, customer_phone, customer_vatin, subtotal_cents, vat_rate_basis_points, vat_cents, usd_total_cents, created_at, updated_at) VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1000, ?, ?, ?, ?)")
          .bind(id, input.projectId, asText(customer.id), input.invoiceDate, asText(customer.company_name_en), asText(customer.company_name_km), asText(customer.contact_name), asText(customer.address_en), asText(customer.address_km), asText(customer.telephone), asText(customer.vatin), totals.subtotalCents, totals.taxCents, totals.totalCents, at, at),
        ...lineValues.map((line, index) => db.prepare("INSERT INTO tax_invoice_lines (id, invoice_id, billing_item_id, description, quantity_units, unit_price_cents, amount_cents, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(line.id, id, line.billingItemId, line.description, line.quantityUnits, line.unitPriceCents, amountCents(line.unitPriceCents, line.quantityUnits), index + 1, at)),
        auditStatement(db, "CREATE_DRAFT", "tax_invoice", id, { projectId: input.projectId, billingItemIds: lineValues.map((line) => line.billingItemId) }, at),
      ];
      await batch(db, statements);
      return invoiceWithLines(db, id);
    },

    async issueInvoice(id: string): Promise<TaxInvoice> {
      const initial = await invoiceRow(db, id);
      if (initial.status !== "DRAFT") throw new RepositoryError("Only a draft invoice can be issued");
      const lines = await all(db,
        "SELECT l.*, b.id AS current_billing_id, b.project_id AS billing_project_id, b.description AS current_description, b.quantity_units AS current_quantity_units, b.final_unit_cents AS current_unit_cents, b.readiness AS current_readiness FROM tax_invoice_lines l LEFT JOIN billing_items b ON b.id = l.billing_item_id WHERE l.invoice_id = ? ORDER BY l.sort_order",
        id,
      );
      if (!lines.length) throw new RepositoryError("Invoice has no billing lines");
      if (lines.length > 10) throw new RepositoryError("The Excel tax invoice layout supports at most 10 billing lines");
      for (const line of lines) {
        if (line.billing_item_id != null && (!line.current_billing_id || line.current_readiness !== "READY" || line.billing_project_id !== initial.project_id)) {
          throw new RepositoryError("Every billing item must belong to the project and be READY", 409);
        }
      }
      const customer = await first(db, "SELECT * FROM customers WHERE id = ?", asText(initial.customer_id));
      if (!customer) throw new RepositoryError("Customer not found", 404);
      const rate = await latestRate();
      if (!rate || rate.rateKhrPerUsd <= 0) throw new RepositoryError("A current NBC exchange rate is required before issue");
      const rateScaled = scaled(rate.rateKhrPerUsd, RATE_SCALE, "NBC USD/KHR rate", Number.MIN_VALUE);
      const totals = lineTotals(lines.map((line) => ({
        unit_price_cents: line.billing_item_id == null ? line.unit_price_cents : line.current_unit_cents,
        quantity_units: line.billing_item_id == null ? line.quantity_units : line.current_quantity_units,
      })));
      const year = Number(asText(initial.invoice_date).slice(0, 4));
      if (!Number.isInteger(year) || year < 2000) throw new RepositoryError("Invoice date has an invalid year");

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const sequenceRow = await first(db, "SELECT next_value FROM invoice_number_sequences WHERE year = ?", year);
        const floor = year === 2026 ? 81 : 1;
        const sequence = Math.max(floor, sequenceRow ? asNumber(sequenceRow.next_value) : 1);
        if (sequence > 999) throw new RepositoryError(`Invoice number sequence for ${year} is exhausted`);
        const invoiceNumber = `CIJDTI${year}${String(sequence).padStart(3, "0")}`;
        const at = now();
        const statements: D1PreparedStatement[] = [
          ...lines.map((line) => db.prepare("UPDATE tax_invoice_lines SET description = ?, quantity_units = ?, unit_price_cents = ?, amount_cents = ? WHERE id = ? AND invoice_id = ?")
            .bind(
              line.billing_item_id == null ? asText(line.description) : asText(line.current_description),
              line.billing_item_id == null ? asNumber(line.quantity_units) : asNumber(line.current_quantity_units),
              line.billing_item_id == null ? asNumber(line.unit_price_cents) : asNumber(line.current_unit_cents),
              amountCents(line.billing_item_id == null ? asNumber(line.unit_price_cents) : asNumber(line.current_unit_cents), line.billing_item_id == null ? asNumber(line.quantity_units) : asNumber(line.current_quantity_units)),
              asText(line.id), id,
            )),
          ...lines.filter((line) => line.billing_item_id != null).map((line) => db.prepare("INSERT INTO billing_item_claims (billing_item_id, invoice_id, claimed_at) VALUES (?, ?, ?)")
            .bind(asText(line.billing_item_id), id, at)),
          ...lines.filter((line) => line.billing_item_id != null).map((line) => db.prepare("UPDATE billing_items SET readiness = 'INVOICED', invoiced_at = ?, updated_at = ? WHERE id = ? AND readiness = 'READY'")
            .bind(at, at, asText(line.billing_item_id))),
          db.prepare("INSERT INTO invoice_number_sequences (year, next_value) VALUES (?, ?) ON CONFLICT(year) DO UPDATE SET next_value = MAX(invoice_number_sequences.next_value, excluded.next_value)")
            .bind(year, sequence + 1),
          db.prepare("UPDATE tax_invoices SET status = 'ISSUED', invoice_number = ?, customer_name_en = ?, customer_name_km = ?, customer_contact_name = ?, customer_address_en = ?, customer_address_km = ?, customer_phone = ?, customer_vatin = ?, subtotal_cents = ?, vat_rate_basis_points = 1000, vat_cents = ?, usd_total_cents = ?, exchange_rate_scaled = ?, exchange_rate_source = ?, exchange_rate_date = ?, khr_total = ?, issued_at = ?, updated_at = ? WHERE id = ? AND status = 'DRAFT'")
            .bind(invoiceNumber, asText(customer.company_name_en), asText(customer.company_name_km), asText(customer.contact_name), asText(customer.address_en), asText(customer.address_km), asText(customer.telephone), asText(customer.vatin), totals.subtotalCents, totals.taxCents, totals.totalCents, rateScaled, rate.source, rate.effectiveDate, khrTotal(totals.totalCents, rateScaled), at, at, id),
          db.prepare("INSERT INTO audit_logs (id, actor, action, entity, entity_id, detail, created_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1")
            .bind(uuid(), "preview-user", "ISSUE", "tax_invoice", id, JSON.stringify({ invoiceNumber, exchangeRateId: rate.id }), at),
        ];
        try {
          const result = await batch(db, statements);
          const invoiceUpdate = result[lines.length + lines.filter((line) => line.billing_item_id != null).length * 2 + 1];
          if (invoiceUpdate?.meta.changes !== 1) throw new RepositoryError("Only a draft invoice can be issued");
          return invoiceWithLines(db, id);
        } catch (error) {
          if (!isInvoiceNumberCollision(error) || attempt === 4) throw error;
          const refreshed = await invoiceRow(db, id);
          if (refreshed.status !== "DRAFT") throw new RepositoryError("Only a draft invoice can be issued");
        }
      }
      throw new RepositoryError("Could not allocate an invoice number after several retries", 409);
    },

    async cancelInvoice(id: string, reason: string): Promise<TaxInvoice> {
      const before = await invoiceRow(db, id);
      if (before.status !== "ISSUED") throw new RepositoryError("Only an issued invoice can be cancelled");
      const trimmed = reason.trim();
      if (!trimmed) throw new RepositoryError("Cancellation reason is required");
      const at = now();
      const result = await batch(db, [
        db.prepare("UPDATE tax_invoices SET status = 'CANCELLED', cancelled_at = ?, cancellation_reason = ?, updated_at = ? WHERE id = ? AND status = 'ISSUED'")
          .bind(at, trimmed, at, id),
        db.prepare("INSERT INTO audit_logs (id, actor, action, entity, entity_id, detail, created_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1")
          .bind(uuid(), "preview-user", "CANCEL", "tax_invoice", id, JSON.stringify({ reason: trimmed, invoiceNumber: before.invoice_number }), at),
      ]);
      if (result[0].meta.changes !== 1) throw new RepositoryError("Only an issued invoice can be cancelled", 409);
      return invoiceWithLines(db, id);
    },

    async duplicateInvoice(id: string): Promise<TaxInvoice> {
      const source = await invoiceWithLines(db, id);
      const copyId = uuid();
      const at = now();
      const date = at.slice(0, 10);
      const statements: D1PreparedStatement[] = [
        db.prepare("INSERT INTO tax_invoices (id, project_id, customer_id, status, invoice_date, customer_name_en, customer_name_km, customer_contact_name, customer_address_en, customer_address_km, customer_phone, customer_vatin, subtotal_cents, vat_rate_basis_points, vat_cents, usd_total_cents, created_at, updated_at) VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1000, ?, ?, ?, ?)")
          .bind(copyId, source.projectId, source.customerId, date, source.customerSnapshot.companyNameEn, source.customerSnapshot.companyNameKm, source.customerSnapshot.contactName, source.customerSnapshot.addressEn, source.customerSnapshot.addressKm, source.customerSnapshot.telephone, source.customerSnapshot.vatin, toCents(source.subtotalUsd, "Subtotal"), toCents(source.vatUsd, "VAT"), toCents(source.totalUsd, "Total"), at, at),
        ...source.lines.map((line) => db.prepare("INSERT INTO tax_invoice_lines (id, invoice_id, billing_item_id, description, quantity_units, unit_price_cents, amount_cents, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(uuid(), copyId, line.billingItemId || null, line.description, scaled(line.quantity, QUANTITY_SCALE, "Quantity", Number.MIN_VALUE), toCents(line.finalUnitUsd, "Unit price"), toCents(line.amountUsd, "Amount"), line.sortOrder, at)),
        auditStatement(db, "DUPLICATE_DRAFT", "tax_invoice", copyId, { sourceInvoiceId: id }, at),
      ];
      await batch(db, statements);
      return invoiceWithLines(db, copyId);
    },

    async saveExchangeRate(input: { rateKhrPerUsd: number; source: string; effectiveDate: string }): Promise<ExchangeRate> {
      if (!input.source.trim() || !isoDate(input.effectiveDate)) throw new RepositoryError("A valid exchange-rate source and date are required");
      const rateScaled = scaled(input.rateKhrPerUsd, RATE_SCALE, "NBC USD/KHR rate", Number.MIN_VALUE);
      const at = now();
      const id = uuid();
      await batch(db, [
        db.prepare("INSERT INTO exchange_rates (id, rate_scaled, source, effective_date, fetched_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(source, effective_date) DO UPDATE SET rate_scaled = excluded.rate_scaled, fetched_at = excluded.fetched_at")
          .bind(id, rateScaled, input.source.trim(), input.effectiveDate, at),
        auditStatement(db, "REFRESH", "exchange_rate", null, { source: input.source.trim(), effectiveDate: input.effectiveDate }, at),
      ]);
      const row = await first(db, "SELECT * FROM exchange_rates WHERE source = ? AND effective_date = ?", input.source.trim(), input.effectiveDate);
      if (!row) throw new RepositoryError("Exchange rate could not be read after save", 500);
      return mapRate(row);
    },

    async getLatestExchangeRate(): Promise<ExchangeRate | null> {
      return latestRate();
    },
  };
}
