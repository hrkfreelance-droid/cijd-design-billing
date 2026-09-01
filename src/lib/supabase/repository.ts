import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";

import {
  RuleError,
  type ConfirmPaymentInput,
  type CreateBillingItemInput,
  type CreateInvoiceInput,
  type CreateProjectInput,
  type Repository,
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
  toUser,
} from "./rows";
import { isProductionComplete, isPrintPriceConfirmed } from "@/lib/derive";
import { roundMoney } from "@/lib/format";
import { ExchangeRateUnavailableError, latestExchangeRate } from "@/lib/exchange-rate";
import { ensureCurrentSupabaseExchangeRate } from "@/lib/exchange-rate-server";
import { supabaseConfig } from "./config";

const DEFAULT_ACTOR = "Hiroki";

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
    const [clients, projects, items, invoices, invoiceItems, users, exchangeRates] = await Promise.all([
      this.db.from("clients").select("*").order("name"),
      this.db.from("projects").select("*").is("deleted_at", null),
      this.db.from("billing_items").select("*").is("deleted_at", null),
      this.db.from("invoices").select("*"),
      this.db.from("invoice_items").select("*"),
      this.db.from("users").select("*"),
      this.db.from("exchange_rates").select("*").eq("currency_pair", "USD/KHR"),
    ]);
    for (const result of [clients, projects, items, invoices, invoiceItems, users]) {
      if (result.error && result.error.code !== "42501" && result.error.code !== "PGRST301") {
        fail(result.error);
      }
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
    const billingItems = (items.data ?? []).map(toItem);
    const rates = (exchangeRates.data ?? []).map(toExchangeRate);
    return {
      clients: (clients.data ?? []).map(toClient),
      projects: (projects.data ?? []).map(toProject),
      billingItems,
      invoices: (invoices.data ?? []).map(toInvoice),
      invoiceItems: (invoiceItems.data ?? []).map(toInvoiceItem),
      users: (users.data ?? []).map(toUser),
      exchangeRate: latestExchangeRate(rates),
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
    const custom = input.amount !== undefined && input.amount !== null;
    const amount = money(custom ? Number(input.amount) : quantity * unitPrice);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new RuleError("INVALID", "Amount must be zero or more.", 400);
    }
    const actor = input.actor ?? DEFAULT_ACTOR;
    const type = input.type ?? "OTHER";
    const imported = actor.trim().toLowerCase() === "import";
    const result = await this.db
      .from("billing_items")
      .insert({
        project_id: input.projectId,
        description,
        type,
        quantity,
        unit_price: unitPrice,
        amount,
        custom_amount: custom,
        production_status: "IN_PROGRESS",
        billing_status: billingStatus,
        print_size: input.printSize ?? null,
        price_review_status: type === "PRINT" ? (imported ? null : "REVIEW_REQUIRED") : "NOT_REQUIRED",
        suggested_unit_price: type === "PRINT" ? unitPrice : null,
        suggested_amount: type === "PRINT" ? amount : null,
        price_source: type === "PRINT" ? input.priceSource ?? null : null,
        price_reason: type === "PRINT" ? input.priceReason ?? null : null,
        note: input.note ?? null,
        created_by: actor,
        updated_by: actor,
      })
      .select()
      .single();
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
    if (patch.amount === null) custom = false;
    else if (patch.amount !== undefined) {
      custom = true;
      amount = money(Number(patch.amount));
    }
    if (!custom) amount = money(quantity * unitPrice);
    if (!Number.isFinite(amount) || amount < 0) {
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

    const result = await this.db
      .from("billing_items")
      .update(changes)
      .eq("id", id)
      .select()
      .single();
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
    const amount = money(quantity * current.unitPrice);
    const updatedAt = new Date().toISOString();
    const result = await this.db
      .from("billing_items")
      .update({
        description,
        print_size: printSize,
        quantity,
        note,
        amount,
        price_review_status: "REVIEW_REQUIRED",
        suggested_unit_price: current.unitPrice,
        suggested_amount: amount,
        price_confirmed_by: null,
        price_confirmed_at: null,
        billing_status: current.billingStatus === "READY_TO_INVOICE" ? "NEEDS_REVIEW" : current.billingStatus,
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
    if (!Number.isFinite(unitPrice) || unitPrice <= 0 || !Number.isFinite(amount) || amount <= 0) {
      throw new RuleError("INVALID", "A confirmed print price must be greater than zero.", 400);
    }
    if (money(amount) !== money(current.quantity * unitPrice)) {
      throw new RuleError("INVALID", "Print total must equal quantity × unit price.", 400);
    }
    const actor = input.actor ?? DEFAULT_ACTOR;
    const confirm = input.confirm ?? false;
    const updatedAt = new Date().toISOString();
    const priceSource = input.priceSource === undefined ? current.priceSource : input.priceSource.trim() || null;
    const priceReason = input.priceReason === undefined ? current.priceReason : input.priceReason.trim() || null;
    const result = await this.db
      .from("billing_items")
      .update({
        suggested_unit_price: current.suggestedUnitPrice ?? current.unitPrice,
        suggested_amount: current.suggestedAmount ?? current.amount,
        unit_price: money(unitPrice),
        amount: money(amount),
        custom_amount: money(amount) !== money(current.quantity * unitPrice),
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
    if (this.accessRole) return this.updatePrintSpecWithAccess(id, patch);
    const result = await this.db.rpc("update_print_spec", {
      p_item_id: id,
      p_description: patch.description ?? null,
      p_print_size: patch.printSize ?? null,
      p_quantity: patch.quantity ?? null,
      p_note: patch.note ?? null,
      p_actor: patch.actor ?? DEFAULT_ACTOR,
    });
    if (result.error) fail(result.error);
    return toItem(result.data as Record<string, unknown>);
  }

  async reviewPrintPrice(id: string, input: Parameters<Repository["reviewPrintPrice"]>[1]) {
    if (this.accessRole) return this.reviewPrintPriceWithAccess(id, input);
    const unitPrice = Number(input.unitPrice);
    const amount = Number(input.amount);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0 || !Number.isFinite(amount) || amount <= 0) {
      throw new RuleError("INVALID", "A confirmed print price must be greater than zero.", 400);
    }
    const current = unwrap<{ quantity: number | string }>(
      await this.db.from("billing_items").select("quantity").eq("id", id).single(),
    );
    const quantity = Number(current.quantity);
    if (!Number.isFinite(quantity) || money(amount) !== money(quantity * unitPrice)) {
      throw new RuleError("INVALID", "Print total must equal quantity × unit price.", 400);
    }
    const result = await this.db.rpc("review_print_price", {
      p_item_id: id,
      p_unit_price: unitPrice,
      p_amount: amount,
      p_confirm: input.confirm ?? false,
      p_price_source: input.priceSource ?? null,
      p_price_reason: input.priceReason ?? null,
      p_actor: input.actor ?? DEFAULT_ACTOR,
    });
    if (result.error) fail(result.error);
    return toItem(result.data as Record<string, unknown>);
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
