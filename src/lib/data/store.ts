import type {
  BillingItem,
  BillingStatus,
  Notification,
  ProductionStatus,
  TelegramSession,
  User,
  Client,
  Database,
  Invoice,
  Project,
  ReceiptStatus,
  Snapshot,
} from "@/lib/types";
import {
  RuleError,
  type ConfirmPaymentInput,
  type CreateBillingItemInput,
  type CreateInvoiceInput,
  type CreateProjectInput,
  type Repository,
  type UpdateBillingItemInput,
} from "./repository";
import { buildSeed } from "./seed";
import {
  isPrintPriceConfirmed,
  isHistoricalRecord,
  isProductionComplete,
  productionAction,
  terminalProductionStatus,
} from "@/lib/derive";

const DEFAULT_ACTOR = "Hiroki";

/**
 * Where a Store keeps its data. The server writes a JSON file; the browser
 * demo writes localStorage. The rules below never need to know which.
 */
export interface Persistence {
  read(): Promise<Database | null>;
  write(db: Database): Promise<void>;
}

function newId(): string {
  return globalThis.crypto.randomUUID();
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function now(): string {
  return new Date().toISOString();
}
function money(n: number): number {
  return Math.round(n * 100) / 100;
}

function log(
  db: Database,
  actor: string,
  action: string,
  entity: string,
  entityId: string,
  detail?: string,
) {
  db.auditLogs.push({
    id: newId(),
    at: now(),
    actor,
    action,
    entity,
    entityId,
    detail,
  });
}

function requireItem(db: Database, id: string): BillingItem {
  const item = db.billingItems.find((i) => i.id === id && !i.deletedAt);
  if (!item) throw new RuleError("NOT_FOUND", `Billing item ${id} was not found.`, 404);
  return item;
}

function requireInvoice(db: Database, id: string): Invoice {
  const invoice = db.invoices.find((i) => i.id === id);
  if (!invoice) throw new RuleError("NOT_FOUND", `Invoice ${id} was not found.`, 404);
  return invoice;
}

/** Manual status moves only cover the pre-invoice part of the flow. */
const MANUAL_STATUSES: BillingStatus[] = ["NOT_READY", "READY_TO_INVOICE", "NEEDS_REVIEW"];

function isLocked(item: BillingItem): boolean {
  return item.billingStatus === "INVOICED" || item.billingStatus === "PAID";
}

function isHistoricalRecordForStore(item: BillingItem): boolean {
  return isHistoricalRecord(item);
}

function assertCurrentPrintItem(item: BillingItem): void {
  if (item.type !== "PRINT") {
    throw new RuleError("INVALID_PRINT", "This operation is only available for print items.", 400);
  }
  if (isHistoricalRecord(item)) {
    throw new RuleError("HISTORY_READ_ONLY", "Imported history is read-only.", 403);
  }
  if (isLocked(item)) {
    throw new RuleError("ITEM_LOCKED", "Invoiced print work cannot be changed.");
  }
}

/**
 * Older records stored a single `status`. Split it so existing data — the local
 * file and anything already in a browser — keeps working.
 */
type LegacyItem = BillingItem & { status?: string };

function migrate(db: Database): Database {
  if (!Array.isArray(db.telegramSessions)) db.telegramSessions = [];
  if (!Array.isArray(db.notifications)) db.notifications = [];
  for (const user of db.users) {
    // "OWNER" predates the designer/billing/accounting split.
    if ((user.role as string) === "OWNER") user.role = "DESIGNER";
  }
  if (!db.users.some((user) => user.role === "ADMIN")) {
    db.users.push({ id: "u_admin", name: "Admin", role: "ADMIN" });
  }
  for (const raw of db.billingItems as LegacyItem[]) {
    if (raw.productionStatus && raw.billingStatus) continue;
    const legacy = raw.status ?? "IN_PROGRESS";
    const delivered =
      legacy === "READY_TO_INVOICE" || legacy === "INVOICED" || legacy === "PAID";
    raw.productionStatus = delivered ? "DELIVERED" : "IN_PROGRESS";
    raw.billingStatus =
      legacy === "IN_PROGRESS" ? "NOT_READY" : (legacy as BillingStatus);
    raw.deliveredAt = delivered ? (raw.deliveredAt ?? raw.updatedAt) : null;
    raw.deliveredBy = delivered ? (raw.deliveredBy ?? raw.updatedBy) : null;
    delete raw.status;
  }
  return db;
}

export class Store implements Repository {
  readonly mode = "local" as const;

  private db: Database | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly persistence: Persistence) {}

  private async load(): Promise<Database> {
    if (this.db) return this.db;
    const stored = await this.persistence.read();
    if (stored) {
      this.db = migrate(stored);
    } else {
      this.db = buildSeed();
      await this.persistence.write(this.db);
    }
    return this.db;
  }

  /** Serialises writes so two callers can never interleave a read-modify-write. */
  private transaction<T>(fn: (db: Database) => T | Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const db = await this.load();
      const result = await fn(db);
      await this.persistence.write(db);
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async getSnapshot(): Promise<Snapshot> {
    const db = await this.load();
    return {
      clients: db.clients,
      projects: db.projects.filter((p) => !p.deletedAt),
      billingItems: db.billingItems.filter((i) => !i.deletedAt),
      invoices: db.invoices,
      invoiceItems: db.invoiceItems,
      users: db.users,
      mode: this.mode,
      scope: { production: true, billing: true, payment: true },
    };
  }

  async rawUsers(): Promise<User[]> {
    return (await this.load()).users;
  }

  createClient({ name, actor = DEFAULT_ACTOR }: { name: string; actor?: string }) {
    return this.transaction((db) => {
      const trimmed = name.trim();
      if (!trimmed) throw new RuleError("INVALID", "Client name is required.", 400);
      if (db.clients.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
        throw new RuleError("DUPLICATE_CLIENT", `${trimmed} already exists.`);
      }
      const client: Client = {
        id: newId(),
        name: trimmed,
        active: true,
        createdAt: now(),
      };
      db.clients.push(client);
      log(db, actor, "client.create", "client", client.id, trimmed);
      return client;
    });
  }

  updateClient(
    id: string,
    patch: { name?: string; active?: boolean; actor?: string },
  ) {
    return this.transaction((db) => {
      const client = db.clients.find((c) => c.id === id);
      if (!client) throw new RuleError("NOT_FOUND", "Client was not found.", 404);
      if (patch.name !== undefined) {
        const trimmed = patch.name.trim();
        if (!trimmed) throw new RuleError("INVALID", "Client name is required.", 400);
        if (
          db.clients.some(
            (c) => c.id !== id && c.name.toLowerCase() === trimmed.toLowerCase(),
          )
        ) {
          throw new RuleError("DUPLICATE_CLIENT", `${trimmed} already exists.`);
        }
        client.name = trimmed;
      }
      if (patch.active !== undefined) client.active = patch.active;
      log(db, patch.actor ?? DEFAULT_ACTOR, "client.update", "client", client.id);
      return client;
    });
  }

  createProject(input: CreateProjectInput) {
    return this.transaction((db) => {
      const name = input.name?.trim();
      if (!name) throw new RuleError("INVALID", "Project name is required.", 400);
      if (!db.clients.some((c) => c.id === input.clientId)) {
        throw new RuleError("INVALID", "Unknown client.", 400);
      }
      const actor = input.createdBy?.trim() || DEFAULT_ACTOR;
      const project: Project = {
        id: newId(),
        clientId: input.clientId,
        name,
        date: input.date ?? today(),
        note: input.note,
        createdAt: now(),
        createdBy: actor,
        updatedAt: now(),
        updatedBy: actor,
        deletedAt: null,
      };
      db.projects.push(project);
      log(db, actor, "project.create", "project", project.id, name);
      return project;
    });
  }

  updateProject(
    id: string,
    patch: { name?: string; date?: string; note?: string; clientId?: string; actor?: string },
  ) {
    return this.transaction((db) => {
      const project = db.projects.find((p) => p.id === id && !p.deletedAt);
      if (!project) throw new RuleError("NOT_FOUND", "Project was not found.", 404);
      if (patch.name !== undefined) {
        const trimmed = patch.name.trim();
        if (!trimmed) throw new RuleError("INVALID", "Project name is required.", 400);
        project.name = trimmed;
      }
      if (patch.date !== undefined) project.date = patch.date;
      if (patch.note !== undefined) project.note = patch.note;
      if (patch.clientId !== undefined) {
        const locked = db.billingItems.some(
          (i) => i.projectId === id && !i.deletedAt && isLocked(i),
        );
        if (locked) {
          throw new RuleError(
            "PROJECT_LOCKED",
            "This project already has invoiced work, so its client cannot be changed.",
          );
        }
        project.clientId = patch.clientId;
      }
      project.updatedAt = now();
      project.updatedBy = patch.actor ?? DEFAULT_ACTOR;
      log(db, project.updatedBy, "project.update", "project", project.id);
      return project;
    });
  }

  createBillingItem(input: CreateBillingItemInput) {
    return this.transaction((db) => {
      const description = input.description?.trim();
      if (!description) throw new RuleError("INVALID", "Description is required.", 400);
      const project = db.projects.find((p) => p.id === input.projectId && !p.deletedAt);
      if (!project) throw new RuleError("INVALID", "Unknown project.", 400);

      const quantity = input.quantity ?? 1;
      const unitPrice = input.unitPrice ?? 0;
      const customAmount = input.amount !== undefined && input.amount !== null;
      const amount = money(customAmount ? Number(input.amount) : quantity * unitPrice);
      if (!Number.isFinite(amount) || amount < 0) {
        throw new RuleError("INVALID", "Amount must be zero or more.", 400);
      }
      const actor = input.actor ?? DEFAULT_ACTOR;
      const type = input.type ?? "OTHER";
      const imported = actor.trim().toLowerCase() === "import";
      const billingStatus = input.billingStatus ?? "NOT_READY";
      if (!MANUAL_STATUSES.includes(billingStatus)) {
        throw new RuleError(
          "INVALID_STATUS",
          "A new item cannot start out as invoiced or paid.",
          400,
        );
      }
      if (billingStatus === "READY_TO_INVOICE") {
        throw new RuleError(
          "NOT_DELIVERED",
          "Finish the work to make it ready to invoice.",
          400,
        );
      }
      const item: BillingItem = {
        id: newId(),
        projectId: input.projectId,
        description,
        type,
        quantity,
        unitPrice,
        amount,
        customAmount,
        productionStatus: "IN_PROGRESS",
        billingStatus,
        deliveredAt: null,
        deliveredBy: null,
        invoiceId: null,
        printSize: input.printSize ?? null,
        priceReviewStatus: type === "PRINT" ? (imported ? null : "REVIEW_REQUIRED") : "NOT_REQUIRED",
        suggestedUnitPrice: type === "PRINT" ? unitPrice : null,
        suggestedAmount: type === "PRINT" ? amount : null,
        priceSource: type === "PRINT" ? input.priceSource ?? null : null,
        priceReason: type === "PRINT" ? input.priceReason ?? null : null,
        priceConfirmedBy: null,
        priceConfirmedAt: null,
        note: input.note,
        createdAt: now(),
        createdBy: actor,
        updatedAt: now(),
        updatedBy: actor,
        deletedAt: null,
      };
      db.billingItems.push(item);
      log(db, actor, "item.create", "billing_item", item.id, description);
      if (type === "PRINT" && !imported) {
        log(db, actor, "price.suggested", "billing_item", item.id, input.priceReason ?? description);
      }
      return item;
    });
  }

  updateBillingItem(id: string, patch: UpdateBillingItemInput) {
    return this.transaction((db) => {
      const item = requireItem(db, id);
      if (isLocked(item)) {
        throw new RuleError(
          "ITEM_LOCKED",
          "This item has already been invoiced. Add a new item instead of changing it.",
        );
      }
      if (patch.description !== undefined) {
        const trimmed = patch.description.trim();
        if (!trimmed) throw new RuleError("INVALID", "Description is required.", 400);
        item.description = trimmed;
      }
      const wasPrint = item.type === "PRINT";
      if (patch.type !== undefined) item.type = patch.type;
      if (patch.quantity !== undefined) item.quantity = patch.quantity;
      if (patch.unitPrice !== undefined) item.unitPrice = patch.unitPrice;
      if (patch.printSize !== undefined) item.printSize = patch.printSize.trim() || null;
      if (patch.note !== undefined) item.note = patch.note;

      if (patch.amount === null) {
        item.customAmount = false;
      } else if (patch.amount !== undefined) {
        item.customAmount = true;
        item.amount = money(Number(patch.amount));
      }
      if (!item.customAmount) item.amount = money(item.quantity * item.unitPrice);
      if (!Number.isFinite(item.amount) || item.amount < 0) {
        throw new RuleError("INVALID", "Amount must be zero or more.", 400);
      }
      const priceChanged =
        patch.type !== undefined ||
        patch.quantity !== undefined ||
        patch.unitPrice !== undefined ||
        patch.amount !== undefined;
      if (item.type === "PRINT" && !isHistoricalRecordForStore(item) && (priceChanged || !wasPrint)) {
        item.priceReviewStatus = "REVIEW_REQUIRED";
        item.suggestedUnitPrice = item.unitPrice;
        item.suggestedAmount = item.amount;
        item.priceConfirmedBy = null;
        item.priceConfirmedAt = null;
        if (item.billingStatus === "READY_TO_INVOICE") item.billingStatus = "NEEDS_REVIEW";
        log(db, patch.actor ?? DEFAULT_ACTOR, "price.suggested", "billing_item", item.id, item.description);
      }
      item.updatedAt = now();
      item.updatedBy = patch.actor ?? DEFAULT_ACTOR;
      log(db, item.updatedBy, "item.update", "billing_item", item.id);
      return item;
    });
  }

  updatePrintSpec(id: string, patch: Parameters<Repository["updatePrintSpec"]>[1]) {
    return this.transaction((db) => {
      const item = requireItem(db, id);
      assertCurrentPrintItem(item);
      const actor = patch.actor ?? DEFAULT_ACTOR;
      if (patch.description !== undefined) {
        const description = patch.description.trim();
        if (!description) throw new RuleError("INVALID", "Description is required.", 400);
        item.description = description;
      }
      if (patch.printSize !== undefined) item.printSize = patch.printSize.trim() || null;
      if (patch.quantity !== undefined) {
        if (!Number.isFinite(patch.quantity) || patch.quantity <= 0) {
          throw new RuleError("INVALID", "Quantity must be greater than zero.", 400);
        }
        item.quantity = patch.quantity;
        if (item.unitPrice > 0) item.amount = money(item.quantity * item.unitPrice);
      }
      if (patch.note !== undefined) item.note = patch.note;
      item.priceReviewStatus = "REVIEW_REQUIRED";
      item.suggestedUnitPrice = item.unitPrice;
      item.suggestedAmount = item.amount;
      item.priceConfirmedBy = null;
      item.priceConfirmedAt = null;
      if (item.billingStatus === "READY_TO_INVOICE") item.billingStatus = "NEEDS_REVIEW";
      item.updatedAt = now();
      item.updatedBy = actor;
      log(db, actor, "print.spec.update", "billing_item", item.id, item.description);
      log(db, actor, "price.suggested", "billing_item", item.id, item.priceReason ?? item.description);
      return item;
    });
  }

  reviewPrintPrice(id: string, input: Parameters<Repository["reviewPrintPrice"]>[1]) {
    return this.transaction((db) => {
      const item = requireItem(db, id);
      assertCurrentPrintItem(item);
      const unitPrice = Number(input.unitPrice);
      const amount = Number(input.amount);
      if (!Number.isFinite(unitPrice) || unitPrice <= 0 || !Number.isFinite(amount) || amount <= 0) {
        throw new RuleError("INVALID", "A confirmed print price must be greater than zero.", 400);
      }
      const actor = input.actor ?? DEFAULT_ACTOR;
      if (item.suggestedUnitPrice == null) item.suggestedUnitPrice = item.unitPrice;
      if (item.suggestedAmount == null) item.suggestedAmount = item.amount;
      item.unitPrice = money(unitPrice);
      item.amount = money(amount);
      item.customAmount = item.amount !== money(item.quantity * item.unitPrice);
      if (input.priceSource !== undefined) item.priceSource = input.priceSource.trim() || null;
      if (input.priceReason !== undefined) item.priceReason = input.priceReason.trim() || null;
      item.priceReviewStatus = input.confirm ? "CONFIRMED" : "REVIEW_REQUIRED";
      item.priceConfirmedBy = input.confirm ? actor : null;
      item.priceConfirmedAt = input.confirm ? now() : null;
      item.updatedAt = now();
      item.updatedBy = actor;
      log(
        db,
        actor,
        input.confirm ? "price.confirm" : "price.edit",
        "billing_item",
        item.id,
        `${item.unitPrice}/${item.amount}`,
      );
      return item;
    });
  }

  setBillingStatus(id: string, status: BillingStatus, actor = DEFAULT_ACTOR) {
    return this.transaction((db) => {
      const item = requireItem(db, id);
      if (!MANUAL_STATUSES.includes(status)) {
        throw new RuleError(
          "INVALID_STATUS",
          "Invoiced and paid are set by the billing and payment steps.",
          400,
        );
      }
      if (item.billingStatus === "INVOICED") {
        throw new RuleError(
          "ITEM_LOCKED",
          "This item is already on an invoice. Cancel the invoice first.",
        );
      }
      if (item.billingStatus === "PAID") {
        throw new RuleError("ITEM_LOCKED", "This item is already paid.");
      }
      // The gate: unfinished work can never be queued for invoicing.
      if (status === "READY_TO_INVOICE" && !isProductionComplete(item)) {
        throw new RuleError(
          "NOT_DELIVERED",
          "Finish the work before sending it to billing.",
        );
      }
      if (status === "READY_TO_INVOICE" && item.type === "PRINT" && !isPrintPriceConfirmed(item)) {
        throw new RuleError(
          "PRICE_REVIEW_REQUIRED",
          "Confirm the print price before sending it to billing.",
        );
      }
      item.billingStatus = status;
      item.updatedAt = now();
      item.updatedBy = actor;
      log(db, actor, "item.billingStatus", "billing_item", item.id, status);
      return item;
    });
  }

  setItemDelivery(id: string, delivered: boolean, actor = DEFAULT_ACTOR) {
    return this.transaction((db) => {
      const item = requireItem(db, id);
      if (productionAction(item) !== "DELIVER") {
        throw new RuleError(
          "WRONG_PRODUCTION_ACTION",
          "Creative work must be marked complete, not delivered.",
        );
      }
      return this.applyProduction(db, item, delivered, actor);
    });
  }

  setItemCompletion(id: string, completed: boolean, actor = DEFAULT_ACTOR) {
    return this.transaction((db) => {
      const item = requireItem(db, id);
      if (productionAction(item) !== "COMPLETE") {
        throw new RuleError(
          "WRONG_PRODUCTION_ACTION",
          "Print items must be marked delivered, not completed.",
        );
      }
      return this.applyProduction(db, item, completed, actor);
    });
  }

  setProjectDelivery(projectId: string, delivered: boolean, actor = DEFAULT_ACTOR) {
    return this.transaction((db) => {
      const project = db.projects.find((p) => p.id === projectId && !p.deletedAt);
      if (!project) throw new RuleError("NOT_FOUND", "Project was not found.", 404);
      const items = db.billingItems.filter((i) => i.projectId === projectId && !i.deletedAt);
      if (!items.length) {
        throw new RuleError(
          "NO_ITEMS",
          "Add what should be billed before marking this delivered.",
        );
      }
      // Already invoiced work is left exactly as it is.
      const open = items.filter((item) => !isLocked(item));
      if (!open.length) {
        throw new RuleError("ITEM_LOCKED", "Every item here has already been invoiced.");
      }
      const changed = open.map((item) => this.applyProduction(db, item, delivered, actor));
      log(
        db,
        actor,
        delivered ? "project.deliver" : "project.undeliver",
        "project",
        project.id,
        project.name,
      );
      return changed;
    });
  }

  /** One place decides what finishing (or undoing it) does to an item. */
  private applyProduction(
    db: Database,
    item: BillingItem,
    delivered: boolean,
    actor: string,
  ): BillingItem {
    if (isLocked(item)) {
      throw new RuleError(
        "ITEM_LOCKED",
        "This item has already been invoiced, so its delivery cannot change.",
      );
    }
    const production: ProductionStatus = terminalProductionStatus(item, delivered);
    item.productionStatus = production;
    item.deliveredAt = delivered ? now() : null;
    item.deliveredBy = delivered ? actor : null;
    // Finishing sends work to billing; undoing pulls it back out.
    if (item.type === "PRINT") {
      item.billingStatus = delivered && isPrintPriceConfirmed(item) ? "READY_TO_INVOICE" : delivered ? "NEEDS_REVIEW" : "NOT_READY";
    } else if (item.billingStatus !== "NEEDS_REVIEW") {
      item.billingStatus = delivered ? "READY_TO_INVOICE" : "NOT_READY";
    }
    item.updatedAt = now();
    item.updatedBy = actor;
    log(
      db,
      actor,
      delivered
        ? productionAction(item) === "DELIVER"
          ? "item.deliver"
          : "item.complete"
        : productionAction(item) === "DELIVER"
          ? "item.undeliver"
          : "item.uncomplete",
      "billing_item",
      item.id,
      item.description,
    );
    return item;
  }

  deleteBillingItem(id: string, actor = DEFAULT_ACTOR) {
    return this.transaction((db) => {
      const item = requireItem(db, id);
      if (isLocked(item)) {
        throw new RuleError(
          "ITEM_LOCKED",
          "Invoiced work is kept as history and cannot be removed.",
        );
      }
      item.deletedAt = now();
      item.updatedAt = now();
      item.updatedBy = actor;
      log(db, actor, "item.delete", "billing_item", item.id, item.description);
    });
  }

  createInvoice(input: CreateInvoiceInput) {
    return this.transaction((db) => {
      const actor = input.actor ?? "Billing Staff";
      const invoiceNumber = input.invoiceNumber?.trim();
      if (!invoiceNumber) throw new RuleError("INVALID", "Invoice number is required.", 400);
      if (!input.billingItemIds?.length) {
        throw new RuleError("INVALID", "Select at least one item.", 400);
      }
      const duplicate = db.invoices.find(
        (i) =>
          i.status !== "VOID" &&
          typeof i.invoiceNumber === "string" &&
          i.invoiceNumber.toLowerCase() === invoiceNumber.toLowerCase(),
      );
      if (duplicate) {
        throw new RuleError(
          "DUPLICATE_INVOICE_NUMBER",
          `Invoice ${duplicate.invoiceNumber} already exists (${duplicate.invoiceDate}).`,
        );
      }

      const items = input.billingItemIds.map((id) => requireItem(db, id));
      for (const item of items) {
        const project = db.projects.find((p) => p.id === item.projectId);
        if (!project || project.clientId !== input.clientId) {
          throw new RuleError("INVALID", "All items must belong to the same client.", 400);
        }
        if (isLocked(item)) {
          throw new RuleError(
            "ALREADY_INVOICED",
            `"${item.description}" has already been invoiced.`,
          );
        }
        // Belt and braces: the gate is enforced here too, not just in the UI.
        if (!isProductionComplete(item)) {
          throw new RuleError(
            "NOT_DELIVERED",
            `"${item.description}" has not been completed yet.`,
          );
        }
        if (item.type === "PRINT" && !isPrintPriceConfirmed(item)) {
          throw new RuleError(
            "PRICE_REVIEW_REQUIRED",
            `"${item.description}" needs a confirmed print price first.`,
          );
        }
        if (item.billingStatus !== "READY_TO_INVOICE") {
          throw new RuleError(
            "NOT_READY",
            `"${item.description}" is not ready to invoice yet.`,
          );
        }
      }

      const amount = money(items.reduce((sum, i) => sum + i.amount, 0));
      const invoice: Invoice = {
        id: newId(),
        clientId: input.clientId,
        invoiceNumber,
        invoiceDate: input.invoiceDate || today(),
        amount,
        status: "ISSUED",
        paymentDate: null,
        paymentSlip: null,
        receiptStatus: "PENDING",
        createdAt: now(),
        createdBy: actor,
        updatedAt: now(),
        updatedBy: actor,
      };
      db.invoices.push(invoice);
      for (const item of items) {
        db.invoiceItems.push({ invoiceId: invoice.id, billingItemId: item.id });
        item.billingStatus = "INVOICED";
        item.invoiceId = invoice.id;
        item.updatedAt = now();
        item.updatedBy = actor;
      }
      log(db, actor, "invoice.create", "invoice", invoice.id, invoiceNumber);
      return invoice;
    });
  }

  voidInvoice(id: string, actor = "Billing Staff") {
    return this.transaction((db) => {
      const invoice = requireInvoice(db, id);
      if (invoice.status === "PAID") {
        throw new RuleError(
          "INVOICE_PAID",
          "This invoice is paid. Undo the payment before cancelling it.",
        );
      }
      if (invoice.status === "VOID") {
        throw new RuleError("ALREADY_VOID", "This invoice was already cancelled.");
      }
      invoice.status = "VOID";
      invoice.receiptStatus = "NOT_REQUIRED";
      invoice.updatedAt = now();
      invoice.updatedBy = actor;
      for (const link of db.invoiceItems.filter((l) => l.invoiceId === id)) {
        const item = db.billingItems.find((i) => i.id === link.billingItemId);
        if (!item) continue;
        item.billingStatus = "READY_TO_INVOICE";
        item.invoiceId = null;
        item.updatedAt = now();
        item.updatedBy = actor;
      }
      db.invoiceItems = db.invoiceItems.filter((l) => l.invoiceId !== id);
      log(db, actor, "invoice.void", "invoice", invoice.id, invoice.invoiceNumber ?? "Unknown");
      return invoice;
    });
  }

  confirmPayment(id: string, input: ConfirmPaymentInput) {
    return this.transaction((db) => {
      const invoice = requireInvoice(db, id);
      const actor = input.actor ?? "Accounting";
      if (invoice.status === "PAID") {
        throw new RuleError(
          "ALREADY_PAID",
          `Invoice ${invoice.invoiceNumber} was already paid on ${invoice.paymentDate}.`,
        );
      }
      if (invoice.status === "VOID") {
        throw new RuleError("INVOICE_VOID", "This invoice was cancelled.");
      }
      invoice.status = "PAID";
      invoice.paymentDate = input.paymentDate || today();
      invoice.paymentSlip = input.slip?.trim() || null;
      if (invoice.receiptStatus === "NOT_REQUIRED") invoice.receiptStatus = "NOT_REQUIRED";
      invoice.updatedAt = now();
      invoice.updatedBy = actor;
      db.payments.push({
        id: newId(),
        invoiceId: invoice.id,
        amount: invoice.amount,
        paidAt: invoice.paymentDate,
        slip: invoice.paymentSlip,
        createdAt: now(),
        createdBy: actor,
        voidedAt: null,
        voidedBy: null,
      });
      for (const link of db.invoiceItems.filter((l) => l.invoiceId === id)) {
        const item = db.billingItems.find((i) => i.id === link.billingItemId);
        if (!item) continue;
        item.billingStatus = "PAID";
        item.updatedAt = now();
        item.updatedBy = actor;
      }
      log(db, actor, "invoice.pay", "invoice", invoice.id, invoice.invoiceNumber ?? "Unknown");
      return invoice;
    });
  }

  revertPayment(id: string, actor = "Accounting") {
    return this.transaction((db) => {
      const invoice = requireInvoice(db, id);
      if (invoice.status !== "PAID") {
        throw new RuleError("NOT_PAID", "This invoice is not marked as paid.");
      }
      invoice.status = "ISSUED";
      invoice.paymentDate = null;
      invoice.paymentSlip = null;
      invoice.updatedAt = now();
      invoice.updatedBy = actor;
      for (const payment of db.payments.filter((p) => p.invoiceId === id && !p.voidedAt)) {
        payment.voidedAt = now();
        payment.voidedBy = actor;
      }
      for (const link of db.invoiceItems.filter((l) => l.invoiceId === id)) {
        const item = db.billingItems.find((i) => i.id === link.billingItemId);
        if (!item) continue;
        item.billingStatus = "INVOICED";
        item.updatedAt = now();
        item.updatedBy = actor;
      }
      log(db, actor, "invoice.unpay", "invoice", invoice.id, invoice.invoiceNumber ?? "Unknown");
      return invoice;
    });
  }

  setReceiptStatus(id: string, status: ReceiptStatus, actor = "Accounting") {
    return this.transaction((db) => {
      const invoice = requireInvoice(db, id);
      invoice.receiptStatus = status;
      invoice.updatedAt = now();
      invoice.updatedBy = actor;
      log(db, actor, "invoice.receipt", "invoice", invoice.id, status);
      return invoice;
    });
  }

  queueNotification(input: {
    kind: "DELIVERY";
    dedupeKey: string;
    projectId: string;
    text: string;
  }): Promise<Notification | null> {
    return this.transaction((db) => {
      const existing = db.notifications.find(
        (n) => n.dedupeKey === input.dedupeKey && n.status !== "FAILED",
      );
      if (existing) return null;
      const notification: Notification = {
        id: newId(),
        kind: input.kind,
        dedupeKey: input.dedupeKey,
        projectId: input.projectId,
        text: input.text,
        status: "PENDING",
        attempts: 0,
        lastError: null,
        createdAt: now(),
        sentAt: null,
      };
      db.notifications.push(notification);
      return notification;
    });
  }

  markNotification(
    id: string,
    status: "SENT" | "FAILED" | "SKIPPED",
    error?: string,
  ): Promise<Notification> {
    return this.transaction((db) => {
      const notification = db.notifications.find((n) => n.id === id);
      if (!notification) {
        throw new RuleError("NOT_FOUND", "Notification was not found.", 404);
      }
      notification.status = status;
      notification.attempts += 1;
      notification.lastError = error ?? null;
      if (status === "SENT") notification.sentAt = now();
      return notification;
    });
  }

  async listNotifications(): Promise<Notification[]> {
    return (await this.load()).notifications;
  }

  async getNotification(id: string): Promise<Notification | null> {
    return (await this.load()).notifications.find((n) => n.id === id) ?? null;
  }

  async getTelegramSession(chatId: string): Promise<TelegramSession | null> {
    const db = await this.load();
    return db.telegramSessions.find((session) => session.chatId === chatId) ?? null;
  }

  saveTelegramSession(session: TelegramSession): Promise<TelegramSession> {
    return this.transaction((db) => {
      const index = db.telegramSessions.findIndex((s) => s.chatId === session.chatId);
      const next = { ...session, updatedAt: now() };
      if (index >= 0) db.telegramSessions[index] = next;
      else db.telegramSessions.push(next);
      return next;
    });
  }
}
