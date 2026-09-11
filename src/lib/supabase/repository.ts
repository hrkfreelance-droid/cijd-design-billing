import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";

import {
  RuleError,
  type ConfirmPaymentInput,
  type CreateBillingItemInput,
  type CreateInvoiceInput,
  type CreateProjectInput,
  type MarkBilledInput,
  type Repository,
  type RestoreBilledInput,
  type UpdateBillingItemInput,
  autoInvoiceNumber,
} from "@/lib/data/repository";
import type { Role } from "@/lib/auth/roles";
import type {
  BillingItem,
  BillingStatus,
  ReceiptStatus,
  Snapshot,
  User,
} from "@/lib/types";
import {
  toClient,
  toExchangeRate,
  toInvoice,
  toInvoiceItem,
  toItem,
  toProject,
  toServiceType,
  toUser,
} from "./rows";
import { markProjectsBilled, restoreProjectsToBilling } from "@/lib/billing-v2/mark-billed";
import { serviceKeyFromName } from "@/lib/billing-v2/services";
import { isProductionComplete, isPrintPriceConfirmed } from "@/lib/derive";
import { roundMoney } from "@/lib/format";
import { printSellingPriceFromCost } from "@/lib/printing-pricing";
import {
  ExchangeRateUnavailableError,
  getApplicableOfficialRate,
  latestOfficialRateCheckedAt,
} from "@/lib/exchange-rate";
import { ensureCurrentSupabaseExchangeRate } from "@/lib/exchange-rate-server";
import { supabaseConfig } from "./config";

type Row = Record<string, unknown>;

const DEFAULT_ACTOR = "Hiroki";

/**
 * `billing_items.service_type` is an additive column. A deployment that has not
 * run the migration yet stays fully usable: the write is retried without the
 * field and the service registry reads the service back from `type`.
 */
let serviceTypeColumn: boolean | null = null;

function missingServiceTypeColumn(error: PostgrestError | null): boolean {
  if (!error) return false;
  const known = error.code === "PGRST204" || error.code === "42703";
  return known && /service_type/i.test(`${error.message} ${error.details ?? ""}`);
}

/**
 * Writes the row, dropping `service_type` once if this database does not have
 * the column yet. The answer is remembered for the life of the worker.
 */
async function writeWithServiceType<T>(
  payload: Record<string, unknown>,
  serviceType: string | null | undefined,
  run: (body: Record<string, unknown>) => PromiseLike<{ data: T | null; error: PostgrestError | null }>,
): Promise<{ data: T | null; error: PostgrestError | null }> {
  if (serviceType === undefined || serviceTypeColumn === false) return run(payload);
  const attempt = await run({ ...payload, service_type: serviceType });
  if (missingServiceTypeColumn(attempt.error)) {
    serviceTypeColumn = false;
    return run(payload);
  }
  if (!attempt.error) serviceTypeColumn = true;
  return attempt;
}

function rateMaintenanceClient(fallback: SupabaseClient): SupabaseClient {
  const config = supabaseConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!config || !serviceRoleKey) return fallback;
  return createClient(config.url, serviceRoleKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
}

function money(value: number): number {
  return roundMoney(value);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Database errors become the same RuleError codes the local store raises, so
 * the API and the UI behave identically whichever store is in use. The SQL
 * functions raise the code as their message and the sentence as the detail.
 */
function fail(error: PostgrestError | null): never {
  if (!error) throw new RuleError("INTERNAL", "Unexpected error", 500);
  const code = error.message?.trim() ?? "";
  const known = [
    "NOT_FOUND",
    "ITEM_LOCKED",
    "NO_ITEMS",
    "INVALID",
    "DUPLICATE_INVOICE_NUMBER",
    "ALREADY_INVOICED",
    "NOT_DELIVERED",
    "WRONG_PRODUCTION_ACTION",
    "NOT_READY",
    "INVOICE_PAID",
    "ALREADY_VOID",
    "ALREADY_PAID",
    "INVOICE_VOID",
    "NOT_PAID",
    "PROJECT_LOCKED",
    "PRICE_REVIEW_REQUIRED",
    "INVALID_PRINT",
    "HISTORY_READ_ONLY",
    "EXCHANGE_RATE_UNAVAILABLE",
    "PRICE_REQUIRED",
    "DUPLICATE_SERVICE",
  ];
  if (known.includes(code)) {
    throw new RuleError(
      code,
      error.details || code,
      code === "NOT_FOUND" ? 404 : code === "EXCHANGE_RATE_UNAVAILABLE" ? 503 : 409,
    );
  }
  // Row level security refused the read or write.
  if (error.code === "42501" || error.code === "PGRST301") {
    throw new RuleError("FORBIDDEN", "You do not have access to this.", 403);
  }
  if (error.code === "23505") {
    throw new RuleError("DUPLICATE_INVOICE_NUMBER", "That value is already in use.");
  }
  if (error.code === "23514") {
    throw new RuleError("NOT_DELIVERED", "Finish the work before billing it.");
  }
    throw new RuleError(
      "INTERNAL",
      error.message || "Database error",
      500,
    );
}

function unwrap<T>(result: { data: T | null; error: PostgrestError | null }): T {
  if (result.error) fail(result.error);
  if (result.data == null) throw new RuleError("NOT_FOUND", "Not found.", 404);
  return result.data;
}

/**
 * Supabase implementation of the same contract as the local store.
 *
 * Reads rely on row level security: an office role simply cannot select
 * undelivered work, so scoping is not something the application has to
 * remember. Multi-table operations go through SQL functions so they are atomic.
 */
export class SupabaseRepository implements Repository {
  readonly mode = "supabase" as const;

  constructor(
    private readonly db: SupabaseClient,
    /** Access-link sessions use the server-only service key without a Supabase JWT. */
    private readonly accessRole: Role | null = null,
  ) {}

  async getSnapshot(): Promise<Snapshot> {
    const [clients, projects, items, invoices, invoiceItems, users, exchangeRates, serviceTypes] = await Promise.all([
      this.db.from("clients").select("*").order("name"),
      this.db.from("projects").select("*").is("deleted_at", null),
      this.db.from("billing_items").select("*").is("deleted_at", null),
      this.db.from("invoices").select("*"),
      this.db.from("invoice_items").select("*"),
      this.db.from("users").select("*"),
      this.db.from("exchange_rates").select("*").eq("currency_pair", "USD/KHR"),
      this.db.from("service_types").select("*").eq("active", true).order("name"),
    ]);
    for (const result of [clients, projects, items, invoices, invoiceItems, users]) {
      if (result.error && result.error.code !== "42501" && result.error.code !== "PGRST301") {
        fail(result.error);
      }
    }
    const serviceTypeRows = serviceTypes.error && ["42P01", "PGRST205"].includes(serviceTypes.error.code ?? "")
      ? [
          { id: "st_design", key: "DESIGN", name: "Design", active: true, created_at: "" },
          { id: "st_printing", key: "PRINTING", name: "Printing", active: true, created_at: "" },
          { id: "st_passport", key: "PASSPORT", name: "Passport", active: true, created_at: "" },
          { id: "st_other", key: "OTHER", name: "Other", active: true, created_at: "" },
        ]
      : serviceTypes.data ?? [];
    if (serviceTypes.error && serviceTypeRows.length === 0 && !["42P01", "PGRST205"].includes(serviceTypes.error.code ?? "")) {
      fail(serviceTypes.error);
    }
    // The migration is additive. Keep the read-only screens usable while a
    // deployment is waiting for the migration, but do not allow a new
    // invoice to be issued until the rate table exists.
    if (
      exchangeRates.error &&
      !["42P01", "PGRST205"].includes(exchangeRates.error.code ?? "")
    ) {
      fail(exchangeRates.error);
    }
    const firstItem = (items.data ?? [])[0] as Record<string, unknown> | undefined;
    if (firstItem) serviceTypeColumn = "service_type" in firstItem;
    const billingItems = (items.data ?? []).map(toItem);
    const rates = (exchangeRates.data ?? []).map(toExchangeRate);
    return {
      clients: (clients.data ?? []).map(toClient),
      projects: (projects.data ?? []).map(toProject),
      billingItems,
      invoices: (invoices.data ?? []).map(toInvoice),
      invoiceItems: (invoiceItems.data ?? []).map(toInvoiceItem),
      users: (users.data ?? []).map(toUser),
      serviceTypes: serviceTypeRows.map(toServiceType),
      exchangeRate: getApplicableOfficialRate(rates),
      exchangeRateLastCheckedAt: latestOfficialRateCheckedAt(rates),
      mode: this.mode,
      // Filled in by the guard; what came back is already what may be seen.
      scope: { production: true, billing: true, payment: true },
    };
  }

  async rawUsers(): Promise<User[]> {
    const result = await this.db.from("users").select("*");
    if (result.error) fail(result.error);
    return (result.data ?? []).map(toUser);
  }

  async createServiceType({ name }: { name: string; actor?: string }) {
    const trimmed = name.trim();
    if (!trimmed) throw new RuleError("INVALID", "Service name is required.", 400);
    const existing = await this.db.from("service_types").select("*");
    if (existing.error) fail(existing.error);
    const key = serviceKeyFromName(trimmed);
    const match = (existing.data ?? []).find(
      (row) => row.key === key || String(row.name).trim().toLowerCase() === trimmed.toLowerCase(),
    );
    if (match?.active) throw new RuleError("DUPLICATE_SERVICE", `${trimmed} already exists.`);
    // A service switched off earlier comes back instead of colliding with itself.
    const result = match
      ? await this.db.from("service_types").update({ active: true, name: trimmed }).eq("id", match.id).select().single()
      : await this.db.from("service_types").insert({ key, name: trimmed }).select().single();
    if (result.error?.code === "23505") throw new RuleError("DUPLICATE_SERVICE", `${trimmed} already exists.`);
    return toServiceType(unwrap(result));
  }

  async updateServiceType(id: string, patch: { name?: string; active?: boolean }) {
    const changes: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      const trimmed = patch.name.trim();
      if (!trimmed) throw new RuleError("INVALID", "Service name is required.", 400);
      changes.name = trimmed;
    }
    if (patch.active !== undefined) changes.active = patch.active;
    const result = await this.db.from("service_types").update(changes).eq("id", id).select().single();
    return toServiceType(unwrap(result));
  }

  async createClient({ name }: { name: string; actor?: string }) {
    const trimmed = name.trim();
    if (!trimmed) throw new RuleError("INVALID", "Client name is required.", 400);
    const result = await this.db
      .from("clients")
      .insert({ name: trimmed })
      .select()
      .single();
    if (result.error?.code === "23505") {
      throw new RuleError("DUPLICATE_CLIENT", `${trimmed} already exists.`);
    }
    return toClient(unwrap(result));
  }

  async updateClient(id: string, patch: { name?: string; active?: boolean }) {
    const changes: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      const trimmed = patch.name.trim();
      if (!trimmed) throw new RuleError("INVALID", "Client name is required.", 400);
      changes.name = trimmed;
    }
    if (patch.active !== undefined) changes.active = patch.active;
    const result = await this.db.from("clients").update(changes).eq("id", id).select().single();
    if (result.error?.code === "23505") {
      throw new RuleError("DUPLICATE_CLIENT", "That client already exists.");
    }
    return toClient(unwrap(result));
  }

  async createProject(input: CreateProjectInput) {
    const name = input.name?.trim();
    if (!name) throw new RuleError("INVALID", "Project name is required.", 400);
    const actor = input.createdBy?.trim() || DEFAULT_ACTOR;
    const result = await this.db
      .from("projects")
      .insert({
        client_id: input.clientId,
        name,
        date: input.date ?? today(),
        note: input.note ?? null,
        created_by: actor,
        updated_by: actor,
      })
      .select()
      .single();
    return toProject(unwrap(result));
  }

  async updateProject(
    id: string,
    patch: { name?: string; date?: string; note?: string; clientId?: string; actor?: string },
  ) {
    if (patch.clientId) {
      const locked = await this.db
        .from("billing_items")
        .select("id")
        .eq("project_id", id)
        .in("billing_status", ["INVOICED", "PAID"])
        .limit(1);
      if ((locked.data ?? []).length) {
        throw new RuleError(
          "PROJECT_LOCKED",
          "This project already has invoiced work, so its client cannot be changed.",
        );
      }
    }
    const changes: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      updated_by: patch.actor ?? DEFAULT_ACTOR,
    };
    if (patch.name !== undefined) {
      const trimmed = patch.name.trim();
      if (!trimmed) throw new RuleError("INVALID", "Project name is required.", 400);
      changes.name = trimmed;
    }
    if (patch.date !== undefined) changes.date = patch.date;
    if (patch.note !== undefined) changes.note = patch.note;
    if (patch.clientId !== undefined) changes.client_id = patch.clientId;
    const result = await this.db.from("projects").update(changes).eq("id", id).select().single();
    return toProject(unwrap(result));
  }

  async setProjectBillingReadiness(
    id: string,
    readiness: "READY" | "IN_PROGRESS" | "AUTO",
    actor = DEFAULT_ACTOR,
  ) {
    const result = await this.db.rpc("set_project_billing_readiness", {
      p_project_id: id,
      p_readiness: readiness,
      p_actor: actor,
    });
    if (result.error) fail(result.error);
    return toProject(result.data as Record<string, unknown>);
  }

  async createBillingItem(input: CreateBillingItemInput) {
    const description = input.description?.trim();
    if (!description) throw new RuleError("INVALID", "Description is required.", 400);
    const billingStatus = input.billingStatus ?? "NOT_READY";
    if (billingStatus === "READY_TO_INVOICE") {
      throw new RuleError(
        "NOT_DELIVERED",
        "Finish the work to make it ready to invoice.",
        400,
      );
    }
    if (!["NOT_READY", "NEEDS_REVIEW"].includes(billingStatus)) {
      throw new RuleError("INVALID_STATUS", "A new item cannot start out as invoiced.", 400);
    }
    const quantity = input.quantity ?? 1;
    const unitPrice = input.unitPrice ?? 0;
    const type = input.type ?? "OTHER";
    const printCost = input.printCost === undefined ? null : money(Number(input.printCost));
    if (printCost !== null && printCost !== undefined && (!Number.isFinite(printCost) || printCost < 0)) {
      throw new RuleError("INVALID", "Printing cost must be zero or more.", 400);
    }
    const custom = input.amount !== undefined && input.amount !== null;
    const hasDerivedAmount = input.unitPrice !== undefined || (type === "PRINT" && printCost !== null);
    const rawAmount = custom
      ? Number(input.amount)
      : type === "PRINT" && printCost !== null
        ? printSellingPriceFromCost(printCost)
        : hasDerivedAmount
          ? quantity * unitPrice
          : null;
    const amount = rawAmount === null ? null : money(rawAmount);
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      throw new RuleError("INVALID", "Amount must be zero or more.", 400);
    }
    const actor = input.actor ?? DEFAULT_ACTOR;
    const imported = actor.trim().toLowerCase() === "import";
    const insert = {
        project_id: input.projectId,
        description,
        type,
        quantity,
        unit_price: unitPrice,
        amount,
        custom_amount: custom,
        billing_price_manual: type === "PRINT" ? custom : false,
        production_status: "IN_PROGRESS",
        billing_status: billingStatus,
        print_size: input.printSize ?? null,
        print_cost: printCost,
        price_review_status: type === "PRINT" ? (imported ? null : "REVIEW_REQUIRED") : "NOT_REQUIRED",
        suggested_unit_price:
          type === "PRINT" && printCost !== null && quantity > 0
            ? money(printSellingPriceFromCost(printCost) / quantity)
            : type === "PRINT"
              ? unitPrice
              : null,
        suggested_amount:
          type === "PRINT" && printCost !== null ? printSellingPriceFromCost(printCost) : type === "PRINT" ? amount : null,
        price_source: type === "PRINT" ? input.priceSource ?? null : null,
        price_reason: type === "PRINT" ? input.priceReason ?? null : null,
        note: input.note ?? null,
        created_by: actor,
        updated_by: actor,
    };
    const result = await writeWithServiceType<Row>(insert, input.serviceType, (body) =>
      this.db.from("billing_items").insert(body).select().single(),
    );
    return toItem(unwrap(result));
  }

  async updateBillingItem(id: string, patch: UpdateBillingItemInput) {
    const current = toItem(unwrap(await this.db.from("billing_items").select("*").eq("id", id).single()));
    if (current.billingStatus === "INVOICED" || current.billingStatus === "PAID") {
      throw new RuleError(
        "ITEM_LOCKED",
        "This item has already been invoiced. Add a new item instead of changing it.",
      );
    }
    const actor = patch.actor ?? DEFAULT_ACTOR;
    const type = patch.type ?? current.type;
    const quantity = patch.quantity ?? current.quantity;
    const unitPrice = patch.unitPrice ?? current.unitPrice;
    let custom = current.customAmount;
    let amount = current.amount;
    if (patch.amount === null) {
      custom = false;
      amount = null;
    }
    else if (patch.amount !== undefined) {
      custom = true;
      amount = money(Number(patch.amount));
    }
    if (patch.amount === undefined && !custom && amount !== null && (patch.quantity !== undefined || patch.unitPrice !== undefined)) {
      amount = money(quantity * unitPrice);
    }
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      throw new RuleError("INVALID", "Amount must be zero or more.", 400);
    }
    const description = patch.description?.trim() ?? current.description;
    if (!description) throw new RuleError("INVALID", "Description is required.", 400);
    const priceChanged =
      type !== current.type ||
      quantity !== current.quantity ||
      unitPrice !== current.unitPrice ||
      amount !== current.amount ||
      custom !== current.customAmount;
    const updatedAt = new Date().toISOString();
    const changes: Record<string, unknown> = {
      description,
      type,
      quantity,
      unit_price: unitPrice,
      amount,
      custom_amount: custom,
      print_size: patch.printSize ?? current.printSize ?? null,
      note: patch.note ?? current.note ?? null,
      updated_at: updatedAt,
      updated_by: actor,
    };
    const currentPrint = current.type === "PRINT" || type === "PRINT";
    if (currentPrint) changes.billing_price_manual = custom;
    const imported = current.createdBy.trim().toLowerCase() === "import";
    if (currentPrint && !imported && priceChanged) {
      changes.suggested_unit_price = unitPrice;
      changes.suggested_amount = amount;
      if (patch.confirmPrice) {
        changes.price_review_status = "CONFIRMED";
        changes.price_confirmed_by = actor;
        changes.price_confirmed_at = updatedAt;
      } else {
        changes.price_review_status = "REVIEW_REQUIRED";
        changes.price_confirmed_by = null;
        changes.price_confirmed_at = null;
        if (current.billingStatus === "READY_TO_INVOICE") changes.billing_status = "NEEDS_REVIEW";
      }
    }

    const result = await writeWithServiceType<Row>(changes, patch.serviceType, (body) =>
      this.db.from("billing_items").update(body).eq("id", id).select().single(),
    );
    const updated = toItem(unwrap(result));
    if (priceChanged) {
      const audit = await this.db.from("audit_logs").insert({
        actor,
        action: patch.confirmPrice ? "price.confirm" : "price.edit",
        entity: "billing_item",
        entity_id: id,
        detail: `${quantity} × ${unitPrice} = ${amount}`,
      });
      if (audit.error) console.error("[audit]", audit.error);
    }
    return updated;
  }

  private async updatePrintSpecWithAccess(
    id: string,
    patch: Parameters<Repository["updatePrintSpec"]>[1],
  ) {
    const current = toItem(
      unwrap(await this.db.from("billing_items").select("*").eq("id", id).single()),
    );
    if (current.type !== "PRINT") {
      throw new RuleError("INVALID_PRINT", "This operation is only available for print items.", 400);
    }
    if (current.createdBy.trim().toLowerCase() === "import") {
      throw new RuleError("HISTORY_READ_ONLY", "Imported history is read-only.", 403);
    }
    if (current.billingStatus === "INVOICED" || current.billingStatus === "PAID") {
      throw new RuleError("ITEM_LOCKED", "This item has already been invoiced.");
    }
    const description = patch.description === undefined ? current.description : patch.description.trim();
    if (!description) throw new RuleError("INVALID", "Description is required.", 400);
    const printSize = patch.printSize === undefined ? current.printSize : patch.printSize.trim() || null;
    const note = patch.note === undefined ? current.note : patch.note.trim() || null;
    const quantity = patch.quantity ?? current.quantity;
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new RuleError("INVALID", "Quantity must be greater than zero.", 400);
    }
    const actor = patch.actor ?? DEFAULT_ACTOR;
    const printCost = patch.printCost === undefined ? current.printCost : money(Number(patch.printCost));
    if (printCost !== null && printCost !== undefined && (!Number.isFinite(printCost) || printCost < 0)) {
      throw new RuleError("INVALID", "Printing cost must be zero or more.", 400);
    }
    const suggestedAmount =
      printCost !== null && printCost !== undefined
        ? printSellingPriceFromCost(printCost)
        : money(quantity * current.unitPrice);
    const preserveManualOverride = current.customAmount;
    const amount = preserveManualOverride ? current.amount : suggestedAmount;
    const updatedAt = new Date().toISOString();
    const result = await this.db
      .from("billing_items")
      .update({
        description,
        print_size: printSize,
        print_cost: printCost,
        quantity,
        note,
        amount,
        billing_price_manual: preserveManualOverride,
        price_review_status: "REVIEW_REQUIRED",
        suggested_unit_price: quantity > 0 ? money(suggestedAmount / quantity) : current.unitPrice,
        suggested_amount: suggestedAmount,
        price_confirmed_by: null,
        price_confirmed_at: null,
        billing_status:
          preserveManualOverride && current.priceReviewStatus === "CONFIRMED"
            ? current.billingStatus
            : current.billingStatus === "READY_TO_INVOICE"
              ? "NEEDS_REVIEW"
              : current.billingStatus,
        updated_at: updatedAt,
        updated_by: actor,
      })
      .eq("id", id)
      .select()
      .single();
    const updated = toItem(unwrap(result));
    const audit = await this.db.from("audit_logs").insert({
      actor,
      action: "print.spec.update",
      entity: "billing_item",
      entity_id: id,
      detail: updated.description,
    });
    if (audit.error) fail(audit.error);
    return updated;
  }

  private async reviewPrintPriceWithAccess(
    id: string,
    input: Parameters<Repository["reviewPrintPrice"]>[1],
  ) {
    const current = toItem(
      unwrap(await this.db.from("billing_items").select("*").eq("id", id).single()),
    );
    if (current.type !== "PRINT") {
      throw new RuleError("INVALID_PRINT", "This operation is only available for print items.", 400);
    }
    if (current.createdBy.trim().toLowerCase() === "import") {
      throw new RuleError("HISTORY_READ_ONLY", "Imported history is read-only.", 403);
    }
    if (current.billingStatus === "INVOICED" || current.billingStatus === "PAID") {
      throw new RuleError("ITEM_LOCKED", "This item has already been invoiced.");
    }
    const unitPrice = Number(input.unitPrice);
    const amount = Number(input.amount);
    if (!Number.isFinite(unitPrice) || unitPrice < 0 || !Number.isFinite(amount) || amount < 0) {
      throw new RuleError("INVALID", "A confirmed print price must be zero or more.", 400);
    }
    const printCost = input.printCost === undefined ? current.printCost : Number(input.printCost);
    if (printCost !== null && printCost !== undefined && (!Number.isFinite(printCost) || printCost < 0)) {
      throw new RuleError("INVALID", "Printing cost must be zero or more.", 400);
    }
    if (
      printCost !== null && printCost !== undefined
        ? money(amount) !== printSellingPriceFromCost(printCost)
        : money(amount) !== money(current.quantity * unitPrice)
    ) {
      throw new RuleError("INVALID", "Print total must equal quantity × unit price.", 400);
    }
    const actor = input.actor ?? DEFAULT_ACTOR;
    const confirm = input.confirm ?? false;
    const preserveManualOverride = printCost !== null && printCost !== undefined && current.customAmount;
    const updatedAt = new Date().toISOString();
    const priceSource = input.priceSource === undefined ? current.priceSource : input.priceSource.trim() || null;
    const priceReason = input.priceReason === undefined ? current.priceReason : input.priceReason.trim() || null;
    const result = await this.db
      .from("billing_items")
      .update({
        print_cost: printCost,
        suggested_unit_price:
          printCost !== null && printCost !== undefined && current.quantity > 0
            ? money(printSellingPriceFromCost(printCost) / current.quantity)
            : current.suggestedUnitPrice ?? current.unitPrice,
        suggested_amount:
          printCost !== null && printCost !== undefined
            ? printSellingPriceFromCost(printCost)
            : current.suggestedAmount ?? current.amount,
        unit_price: preserveManualOverride ? current.unitPrice : money(unitPrice),
        amount: preserveManualOverride ? current.amount : money(amount),
        custom_amount:
          preserveManualOverride ? true : printCost === null || printCost === undefined
            ? money(amount) !== money(current.quantity * unitPrice)
            : false,
        billing_price_manual: preserveManualOverride,
        price_source: priceSource,
        price_reason: priceReason,
        price_review_status: confirm ? "CONFIRMED" : "REVIEW_REQUIRED",
        price_confirmed_by: confirm ? actor : null,
        price_confirmed_at: confirm ? updatedAt : null,
        updated_at: updatedAt,
        updated_by: actor,
      })
      .eq("id", id)
      .select()
      .single();
    const updated = toItem(unwrap(result));
    const audit = await this.db.from("audit_logs").insert({
      actor,
      action: confirm ? "price.confirm" : "price.edit",
      entity: "billing_item",
      entity_id: id,
      detail: `${updated.unitPrice}/${updated.amount}`,
    });
    if (audit.error) fail(audit.error);
    return updated;
  }

  async updatePrintSpec(id: string, patch: Parameters<Repository["updatePrintSpec"]>[1]) {
    const result = await this.db.rpc("update_print_spec", {
      p_item_id: id,
      p_description: patch.description ?? null,
      p_print_size: patch.printSize ?? null,
      p_quantity: patch.quantity ?? null,
      p_print_cost: patch.printCost ?? null,
      p_note: patch.note ?? null,
      p_actor: patch.actor ?? DEFAULT_ACTOR,
    });
    if (result.error) fail(result.error);
    return toItem(result.data as Record<string, unknown>);
  }

  async reviewPrintPrice(id: string, input: Parameters<Repository["reviewPrintPrice"]>[1]) {
    const unitPrice = Number(input.unitPrice);
    const amount = Number(input.amount);
    if (!Number.isFinite(unitPrice) || unitPrice < 0 || !Number.isFinite(amount) || amount < 0) {
      throw new RuleError("INVALID", "A confirmed print price must be zero or more.", 400);
    }
    const current = unwrap<{ quantity: number | string }>(
      await this.db.from("billing_items").select("quantity").eq("id", id).single(),
    );
    const quantity = Number(current.quantity);
    const printCost = input.printCost;
    if (printCost !== undefined && (!Number.isFinite(printCost) || printCost < 0)) {
      throw new RuleError("INVALID", "Printing cost must be zero or more.", 400);
    }
    const expectedAmount =
      printCost !== undefined
        ? printSellingPriceFromCost(printCost)
        : money(quantity * unitPrice);
    if (!Number.isFinite(quantity) || money(amount) !== expectedAmount) {
      throw new RuleError("INVALID", "Print total must equal quantity × unit price.", 400);
    }
    const result = await this.db.rpc("review_print_price", {
      p_item_id: id,
      p_unit_price: unitPrice,
      p_amount: amount,
      p_print_cost: input.printCost ?? null,
      p_confirm: input.confirm ?? false,
      p_price_source: input.priceSource ?? null,
      p_price_reason: input.priceReason ?? null,
      p_actor: input.actor ?? DEFAULT_ACTOR,
    });
    if (result.error) fail(result.error);
    return toItem(result.data as Record<string, unknown>);
  }

  async overrideBillingPrice(id: string, amount: number, actor = DEFAULT_ACTOR) {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new RuleError("INVALID", "Billing price must be zero or more.", 400);
    }
    // $0 is a real price (a free revision), but the SQL function predates that
    // and only accepts a positive amount. A trusted server session writes it
    // directly, with the same fields the function would set.
    if (amount === 0 && this.accessRole) return this.writeBillingPrice(id, amount, actor);
    // The SQL function is the only path that announces the operation to the
    // billing-item triggers; a plain UPDATE from a session with no application
    // role is refused by the print guard. Try it first for every caller, and
    // keep the direct write as the fallback for a session the function itself
    // will not accept.
    const viaFunction = await this.db.rpc("override_billing_price", {
      p_item_id: id,
      p_amount: amount,
      p_actor: actor,
    });
    if (!viaFunction.error) return toItem(viaFunction.data as Row);
    const refused =
      viaFunction.error.message?.trim() === "FORBIDDEN" ||
      viaFunction.error.code === "42501" ||
      viaFunction.error.code === "PGRST301";
    if (!refused || !this.accessRole) fail(viaFunction.error);
    return this.writeBillingPrice(id, amount, actor);
  }

  private async writeBillingPrice(id: string, amount: number, actor: string) {
    const current = toItem(unwrap(await this.db.from("billing_items").select("*").eq("id", id).single()));
    if (current.billingStatus === "INVOICED" || current.billingStatus === "PAID") {
      throw new RuleError("ITEM_LOCKED", "This item has already been invoiced and cannot be edited.");
    }
    const updatedAt = new Date().toISOString();
    const result = await this.db
      .from("billing_items")
      .update({
        amount: money(amount),
        custom_amount: true,
        billing_price_manual: current.type === "PRINT",
        price_review_status: current.type === "PRINT" ? "CONFIRMED" : current.priceReviewStatus,
        price_confirmed_by: current.type === "PRINT" ? actor : current.priceConfirmedBy,
        price_confirmed_at: current.type === "PRINT" ? updatedAt : current.priceConfirmedAt,
        updated_at: updatedAt,
        updated_by: actor,
      })
      .eq("id", id)
      .select()
      .single();
    const updated = toItem(unwrap(result));
    const audit = await this.db.from("audit_logs").insert({
      actor,
      action: "billing.price.override",
      entity: "billing_item",
      entity_id: id,
      detail: String(updated.amount),
    });
    if (audit.error) console.error("[audit]", audit.error);
    return updated;
  }

  async setBillingStatus(id: string, status: BillingStatus, actor = DEFAULT_ACTOR) {
    if (!["NOT_READY", "READY_TO_INVOICE", "NEEDS_REVIEW"].includes(status)) {
      throw new RuleError(
        "INVALID_STATUS",
        "Invoiced and paid are set by the billing and payment steps.",
        400,
      );
    }
    const current = toItem(unwrap(await this.db.from("billing_items").select("*").eq("id", id).single()));
    if (current.billingStatus === "INVOICED") {
      throw new RuleError("ITEM_LOCKED", "This item is already on an invoice.");
    }
    if (current.billingStatus === "PAID") {
      throw new RuleError("ITEM_LOCKED", "This item is already paid.");
    }
    if (status === "READY_TO_INVOICE" && !isProductionComplete(current)) {
      throw new RuleError(
        "NOT_DELIVERED",
        "Finish the work before sending it to billing.",
      );
    }
    if (status === "READY_TO_INVOICE" && current.type === "PRINT" && !isPrintPriceConfirmed(current)) {
      throw new RuleError("PRICE_REVIEW_REQUIRED", "Confirm the print price before sending it to billing.");
    }
    const result = await this.db
      .from("billing_items")
      .update({
        billing_status: status,
        updated_at: new Date().toISOString(),
        updated_by: actor,
      })
      .eq("id", id)
      .select()
      .single();
    return toItem(unwrap(result));
  }

  async setItemDelivery(id: string, delivered: boolean, actor = DEFAULT_ACTOR) {
    const result = await this.db.rpc("set_item_delivery", {
      p_item_id: id,
      p_delivered: delivered,
      p_actor: actor,
    });
    if (result.error) fail(result.error);
    return toItem(result.data as Record<string, unknown>);
  }

  async setItemCompletion(id: string, completed: boolean, actor = DEFAULT_ACTOR) {
    const result = await this.db.rpc("set_item_completion", {
      p_item_id: id,
      p_completed: completed,
      p_actor: actor,
    });
    if (result.error) fail(result.error);
    return toItem(result.data as Record<string, unknown>);
  }

  async setProjectDelivery(projectId: string, delivered: boolean, actor = DEFAULT_ACTOR) {
    const result = await this.db.rpc("set_project_delivery", {
      p_project_id: projectId,
      p_delivered: delivered,
      p_actor: actor,
    });
    if (result.error) fail(result.error);
    return ((result.data ?? []) as Record<string, unknown>[]).map(toItem);
  }

  async deleteBillingItem(id: string, actor = DEFAULT_ACTOR) {
    const current = toItem(unwrap(await this.db.from("billing_items").select("*").eq("id", id).single()));
    if (current.billingStatus === "INVOICED" || current.billingStatus === "PAID") {
      throw new RuleError("ITEM_LOCKED", "Invoiced work is kept as history and cannot be removed.");
    }
    const result = await this.db
      .from("billing_items")
      .update({ deleted_at: new Date().toISOString(), updated_by: actor })
      .eq("id", id);
    if (result.error) fail(result.error);
  }

  markProjectsBilled(input: MarkBilledInput) {
    return markProjectsBilled(this, input);
  }

  restoreProjectsToBilling(input: RestoreBilledInput) {
    return restoreProjectsToBilling(this, input);
  }

  async deleteProject(id: string, actor = DEFAULT_ACTOR) {
    const result = await this.db
      .from("projects")
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString(), updated_by: actor })
      .eq("id", id);
    if (result.error) fail(result.error);
    const audit = await this.db.from("audit_logs").insert({
      actor,
      action: "project.delete",
      entity: "project",
      entity_id: id,
    });
    if (audit.error) console.error("[audit]", audit.error);
  }

  async createInvoice(input: CreateInvoiceInput) {
    try {
      await ensureCurrentSupabaseExchangeRate(rateMaintenanceClient(this.db));
    } catch (error) {
      if (error instanceof ExchangeRateUnavailableError) {
        throw new RuleError(
          "EXCHANGE_RATE_UNAVAILABLE",
          "為替レートを取得できませんでした。しばらくして再度お試しください。",
          503,
        );
      }
      throw error;
    }
    const invoiceNumber = input.invoiceNumber?.trim() || autoInvoiceNumber();
    const result = await this.db.rpc("create_invoice", {
      p_client_id: input.clientId,
      p_invoice_number: invoiceNumber,
      p_invoice_date: input.invoiceDate || today(),
      p_item_ids: input.billingItemIds,
      p_actor: input.actor ?? "Billing Staff",
    });
    if (result.error) fail(result.error);
    return toInvoice(result.data as Record<string, unknown>);
  }

  async voidInvoice(id: string, actor = "Billing Staff") {
    const result = await this.db.rpc("void_invoice", { p_invoice_id: id, p_actor: actor });
    if (result.error) fail(result.error);
    return toInvoice(result.data as Record<string, unknown>);
  }

  async confirmPayment(id: string, input: ConfirmPaymentInput) {
    const result = await this.db.rpc("confirm_payment", {
      p_invoice_id: id,
      p_paid_at: input.paymentDate || today(),
      p_slip: input.slip ?? null,
      p_actor: input.actor ?? "Accounting",
    });
    if (result.error) fail(result.error);
    return toInvoice(result.data as Record<string, unknown>);
  }

  async revertPayment(id: string, actor = "Accounting") {
    const result = await this.db.rpc("revert_payment", { p_invoice_id: id, p_actor: actor });
    if (result.error) fail(result.error);
    return toInvoice(result.data as Record<string, unknown>);
  }

  async setReceiptStatus(id: string, status: ReceiptStatus, actor = "Accounting") {
    const result = await this.db
      .from("invoices")
      .update({
        receipt_status: status,
        updated_at: new Date().toISOString(),
        updated_by: actor,
      })
      .eq("id", id)
      .select()
      .single();
    return toInvoice(unwrap(result));
  }

}

export type { BillingItem };
