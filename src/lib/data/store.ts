import type {
  BillingItem,
  BillingStatus,
  ProductionStatus,
  User,
  Client,
  Database,
  Invoice,
  Project,
  ReceiptStatus,
  Snapshot,
  ServiceType,
} from "@/lib/types";
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
} from "./repository";
import { markProjectsBilled, restoreProjectsToBilling } from "@/lib/billing-v2/mark-billed";
import { serviceKeyFromName } from "@/lib/billing-v2/services";
import { buildSeed } from "./seed";
import {
  isPrintPriceConfirmed,
  isHistoricalRecord,
  isProductionComplete,
  productionAction,
  terminalProductionStatus,
} from "@/lib/derive";
import { roundMoney } from "@/lib/format";
import { printSellingPriceFromCost } from "@/lib/printing-pricing";
import {
  ensureCurrentExchangeRate,
  ExchangeRateUnavailableError,
  getApplicableOfficialRate,
  latestOfficialRateCheckedAt,
} from "@/lib/exchange-rate";

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
  return roundMoney(n);
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
  if (!Array.isArray(db.exchangeRates)) db.exchangeRates = [];
  if (!Array.isArray(db.exchangeRateFailures)) db.exchangeRateFailures = [];
  if (!Array.isArray(db.serviceTypes)) db.serviceTypes = [];
  for (const [key, name] of [["DESIGN", "Design"], ["PRINTING", "Printing"], ["PASSPORT", "Passport"], ["OTHER", "Other"]] as const) {
    if (!db.serviceTypes.some((service) => service.key === key)) {
      db.serviceTypes.push({ id: `st_${key.toLowerCase()}`, key, name, active: true, createdAt: now() });
    }
  }
  for (const project of db.projects) project.billingReadiness ??= "AUTO";
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
    const stored = await this.persistence.read();
    if (stored) {
      this.db = migrate(stored);
      return this.db;
    }
    if (this.db) return this.db;
    this.db = buildSeed();
    await this.persistence.write(this.db);
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
      serviceTypes: db.serviceTypes,
      exchangeRate: getApplicableOfficialRate(db.exchangeRates),
      exchangeRateLastCheckedAt: latestOfficialRateCheckedAt(db.exchangeRates),
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

  createServiceType({ name, actor = DEFAULT_ACTOR }: { name: string; actor?: string }) {
    return this.transaction((db) => {
      const trimmed = name.trim();
      if (!trimmed) throw new RuleError("INVALID", "Service name is required.", 400);
      const key = serviceKeyFromName(trimmed);
      const match = db.serviceTypes.find(
        (service) => service.key === key || service.name.trim().toLowerCase() === trimmed.toLowerCase(),
      );
      if (match?.active) throw new RuleError("DUPLICATE_SERVICE", `${trimmed} already exists.`);
      if (match) {
        match.active = true;
        match.name = trimmed;
        log(db, actor, "service_type.update", "service_type", match.id, trimmed);
        return match;
      }
      const service: ServiceType = {
        id: newId(),
        key,
        name: trimmed,
        active: true,
        createdAt: now(),
      };
      db.serviceTypes.push(service);
      log(db, actor, "service_type.create", "service_type", service.id, trimmed);
      return service;
    });
  }

  updateServiceType(id: string, patch: { name?: string; active?: boolean; actor?: string }) {
    return this.transaction((db) => {
      const service = db.serviceTypes.find((candidate) => candidate.id === id);
      if (!service) throw new RuleError("NOT_FOUND", "Service was not found.", 404);
      if (patch.name !== undefined) {
        const trimmed = patch.name.trim();
        if (!trimmed) throw new RuleError("INVALID", "Service name is required.", 400);
        service.name = trimmed;
      }
      if (patch.active !== undefined) service.active = patch.active;
      log(db, patch.actor ?? DEFAULT_ACTOR, "service_type.update", "service_type", id);
      return service;
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
        billingReadiness: "AUTO",
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

  setProjectBillingReadiness(
    id: string,
    readiness: "READY" | "IN_PROGRESS" | "AUTO",
    actor = DEFAULT_ACTOR,
  ) {
    return this.transaction((db) => {
      const project = db.projects.find((candidate) => candidate.id === id && !candidate.deletedAt);
      if (!project) throw new RuleError("NOT_FOUND", "Project was not found.", 404);
      const items = db.billingItems.filter(
        (item) => item.projectId === id && !item.deletedAt && !isLocked(item),
      );
      if (readiness === "READY") {
        if (!items.length) throw new RuleError("NO_ITEMS", "Add what should be billed first.", 400);
        if (items.some((item) => item.amount === null)) {
          throw new RuleError("PRICE_REQUIRED", "1 item still needs a billing price.", 400);
        }
      }
      project.billingReadiness = readiness;
      project.updatedAt = now();
      project.updatedBy = actor;
      if (readiness === "READY") {
        for (const item of items) item.billingStatus = "READY_TO_INVOICE";
      } else if (readiness === "IN_PROGRESS") {
        for (const item of items) item.billingStatus = "NOT_READY";
      }
      log(db, actor, "project.billingReadiness", "project", id, readiness);
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
      const type = input.type ?? "OTHER";
      const printCost = input.printCost === undefined ? null : money(Number(input.printCost));
      if (printCost !== null && (!Number.isFinite(printCost) || printCost < 0)) {
        throw new RuleError("INVALID", "Printing cost must be zero or more.", 400);
      }
      const customAmount = input.amount !== undefined && input.amount !== null;
      const hasDerivedAmount = input.unitPrice !== undefined || (type === "PRINT" && printCost !== null);
      const rawAmount = customAmount
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
      const suggestedAmount =
        type === "PRINT" && printCost !== null ? printSellingPriceFromCost(printCost) : amount;
      const item: BillingItem = {
        id: newId(),
        projectId: input.projectId,
        description,
        type,
        serviceType: input.serviceType ?? null,
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
        printCost,
        priceReviewStatus: type === "PRINT" ? (imported ? null : "REVIEW_REQUIRED") : "NOT_REQUIRED",
        suggestedUnitPrice:
          type === "PRINT"
            ? printCost !== null && quantity > 0
              ? money((suggestedAmount ?? 0) / quantity)
              : unitPrice
            : null,
        suggestedAmount: type === "PRINT" ? suggestedAmount : null,
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
      if (isHistoricalRecord(item)) {
        throw new RuleError("HISTORY_READ_ONLY", "Imported history is read-only.");
      }
      if (isLocked(item)) {
        throw new RuleError(
          "ITEM_LOCKED",
          "This item has already been invoiced. Add a new item instead of changing it.",
        );
      }
      const actor = patch.actor ?? DEFAULT_ACTOR;
      const wasPrint = item.type === "PRINT";
      const wasPriceConfirmed = wasPrint && item.priceReviewStatus === "CONFIRMED";
      const previousPrice = {
        type: item.type,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        amount: item.amount,
        customAmount: item.customAmount,
      };
      if (patch.description !== undefined) {
        const trimmed = patch.description.trim();
        if (!trimmed) throw new RuleError("INVALID", "Description is required.", 400);
        item.description = trimmed;
      }
      if (patch.type !== undefined) item.type = patch.type;
      if (patch.serviceType !== undefined) item.serviceType = patch.serviceType;
      if (patch.quantity !== undefined) item.quantity = patch.quantity;
      if (patch.unitPrice !== undefined) item.unitPrice = patch.unitPrice;
      if (patch.printSize !== undefined) item.printSize = patch.printSize.trim() || null;
      if (patch.note !== undefined) item.note = patch.note;

      if (patch.amount === null) {
        item.customAmount = false;
        item.amount = null;
      } else if (patch.amount !== undefined) {
        item.customAmount = true;
        item.amount = money(Number(patch.amount));
      }
      if (
        patch.amount === undefined &&
        !item.customAmount &&
        item.amount !== null &&
        (patch.quantity !== undefined || patch.unitPrice !== undefined)
      ) {
        item.amount = money(item.quantity * item.unitPrice);
      }
      if (item.amount !== null && (!Number.isFinite(item.amount) || item.amount < 0)) {
        throw new RuleError("INVALID", "Amount must be zero or more.", 400);
      }
      const priceChanged =
        previousPrice.type !== item.type ||
        previousPrice.quantity !== item.quantity ||
        previousPrice.unitPrice !== item.unitPrice ||
        previousPrice.amount !== item.amount ||
        previousPrice.customAmount !== item.customAmount;
      const priceDetail = `${item.quantity} × ${item.unitPrice} = ${item.amount ?? "unset"}`;
      if (item.type === "PRINT" && !isHistoricalRecordForStore(item) && (priceChanged || !wasPrint)) {
        item.suggestedUnitPrice = item.unitPrice;
        item.suggestedAmount = item.amount;
        if (patch.confirmPrice) {
          item.priceReviewStatus = "CONFIRMED";
          item.priceConfirmedBy = actor;
          item.priceConfirmedAt = now();
          log(db, actor, "price.confirm", "billing_item", item.id, priceDetail);
        } else {
          if (wasPriceConfirmed) {
            log(db, actor, "price.confirmation_invalidated", "billing_item", item.id, item.description);
          }
          item.priceReviewStatus = "REVIEW_REQUIRED";
          item.priceConfirmedBy = null;
          item.priceConfirmedAt = null;
          if (item.billingStatus === "READY_TO_INVOICE") item.billingStatus = "NEEDS_REVIEW";
          log(db, actor, "price.suggested", "billing_item", item.id, item.description);
        }
      } else if (priceChanged) {
        log(db, actor, patch.confirmPrice ? "price.confirm" : "price.edit", "billing_item", item.id, priceDetail);
      }
      item.updatedAt = now();
      item.updatedBy = actor;
      log(db, item.updatedBy, "item.update", "billing_item", item.id);
      return item;
    });
  }

  updatePrintSpec(id: string, patch: Parameters<Repository["updatePrintSpec"]>[1]) {
    return this.transaction((db) => {
      const item = requireItem(db, id);
      assertCurrentPrintItem(item);
      const actor = patch.actor ?? DEFAULT_ACTOR;
      const wasPriceConfirmed = item.priceReviewStatus === "CONFIRMED";
      const wasManualOverride = item.customAmount;
      if (patch.description !== undefined) {
        const description = patch.description.trim();
        if (!description) throw new RuleError("INVALID", "Description is required.", 400);
        item.description = description;
      }
      if (patch.printSize !== undefined) item.printSize = patch.printSize.trim() || null;
      if (patch.printCost !== undefined) {
        const printCost = money(Number(patch.printCost));
        if (!Number.isFinite(printCost) || printCost < 0) {
          throw new RuleError("INVALID", "Printing cost must be zero or more.", 400);
        }
        item.printCost = printCost;
      }
      if (patch.quantity !== undefined) {
        if (!Number.isFinite(patch.quantity) || patch.quantity <= 0) {
          throw new RuleError("INVALID", "Quantity must be greater than zero.", 400);
        }
        item.quantity = patch.quantity;
      }
      if (patch.note !== undefined) item.note = patch.note;
      const suggestedAmount =
        item.printCost !== null && item.printCost !== undefined
          ? printSellingPriceFromCost(item.printCost)
          : money(item.quantity * item.unitPrice);
      item.suggestedUnitPrice = item.quantity > 0 ? money(suggestedAmount / item.quantity) : item.unitPrice;
      item.suggestedAmount = suggestedAmount;
      if (!wasManualOverride) item.amount = suggestedAmount;
      if (!(wasManualOverride && wasPriceConfirmed)) {
        item.priceReviewStatus = "REVIEW_REQUIRED";
        item.priceConfirmedBy = null;
        item.priceConfirmedAt = null;
        if (item.billingStatus === "READY_TO_INVOICE") item.billingStatus = "NEEDS_REVIEW";
      }
      item.updatedAt = now();
      item.updatedBy = actor;
      if (wasPriceConfirmed) {
        log(db, actor, "price.confirmation_invalidated", "billing_item", item.id, item.description);
      }
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
      if (!Number.isFinite(unitPrice) || unitPrice < 0 || !Number.isFinite(amount) || amount < 0) {
        throw new RuleError("INVALID", "A confirmed print price must be zero or more.", 400);
      }
      const printCost = input.printCost === undefined ? item.printCost : Number(input.printCost);
      if (printCost !== null && printCost !== undefined && (!Number.isFinite(printCost) || printCost < 0)) {
        throw new RuleError("INVALID", "Printing cost must be zero or more.", 400);
      }
      if (
        printCost !== null && printCost !== undefined
          ? money(amount) !== printSellingPriceFromCost(printCost)
          : money(amount) !== money(item.quantity * unitPrice)
      ) {
        throw new RuleError("INVALID", "Print total must equal quantity × unit price.", 400);
      }
      const actor = input.actor ?? DEFAULT_ACTOR;
      const wasPriceConfirmed = item.priceReviewStatus === "CONFIRMED";
      if (item.suggestedUnitPrice == null) item.suggestedUnitPrice = item.unitPrice;
      if (item.suggestedAmount == null) item.suggestedAmount = item.amount;
      if (printCost !== null && printCost !== undefined) {
        item.printCost = money(printCost);
        item.suggestedAmount = printSellingPriceFromCost(printCost);
        item.suggestedUnitPrice = item.quantity > 0 ? money(item.suggestedAmount / item.quantity) : unitPrice;
      }
      item.unitPrice = money(unitPrice);
      item.amount = money(amount);
      item.customAmount = printCost === null || printCost === undefined
        ? item.amount !== money(item.quantity * item.unitPrice)
        : false;
      if (input.priceSource !== undefined) item.priceSource = input.priceSource.trim() || null;
      if (input.priceReason !== undefined) item.priceReason = input.priceReason.trim() || null;
      item.priceReviewStatus = input.confirm ? "CONFIRMED" : "REVIEW_REQUIRED";
      item.priceConfirmedBy = input.confirm ? actor : null;
      item.priceConfirmedAt = input.confirm ? now() : null;
      item.updatedAt = now();
      item.updatedBy = actor;
      if (!input.confirm && wasPriceConfirmed) {
        log(db, actor, "price.confirmation_invalidated", "billing_item", item.id, item.description);
      }
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

  overrideBillingPrice(id: string, amount: number, actor = "Billing Staff") {
    return this.transaction((db) => {
      const item = requireItem(db, id);
      if (isHistoricalRecord(item)) {
        throw new RuleError("HISTORY_READ_ONLY", "Imported history is read-only.");
      }
      if (isLocked(item)) {
        throw new RuleError("ITEM_LOCKED", "This item has already been invoiced and cannot be edited.");
      }
      if (!Number.isFinite(amount) || amount < 0) {
        throw new RuleError("INVALID", "Billing price must be zero or more.", 400);
      }
      item.amount = money(amount);
      item.customAmount = true;
      if (item.type === "PRINT") {
        item.suggestedAmount ??= item.printCost != null ? printSellingPriceFromCost(item.printCost) : item.amount;
        item.suggestedUnitPrice ??= item.quantity > 0 ? money(item.suggestedAmount / item.quantity) : item.unitPrice;
        item.priceReviewStatus = "CONFIRMED";
        item.priceConfirmedBy = actor;
        item.priceConfirmedAt = now();
      }
      item.updatedAt = now();
      item.updatedBy = actor;
      log(db, actor, "billing.price.override", "billing_item", item.id, String(item.amount));
      return item;
    });
  }

  setBillingStatus(id: string, status: BillingStatus, actor = DEFAULT_ACTOR) {
    return this.transaction((db) => {
      const item = requireItem(db, id);
      if (isHistoricalRecord(item)) {
        throw new RuleError("HISTORY_READ_ONLY", "Imported history is read-only.");
      }
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
      if (isHistoricalRecord(item)) {
        throw new RuleError("HISTORY_READ_ONLY", "Imported history is read-only.");
      }
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
      if (isHistoricalRecord(item)) {
        throw new RuleError("HISTORY_READ_ONLY", "Imported history is read-only.");
      }
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
      const open = items.filter((item) => !isLocked(item) && !isHistoricalRecord(item));
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
      if (isHistoricalRecord(item)) {
        throw new RuleError("HISTORY_READ_ONLY", "Imported history is read-only.");
      }
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

  markProjectsBilled(input: MarkBilledInput) {
    return markProjectsBilled(this, input);
  }

  restoreProjectsToBilling(input: RestoreBilledInput) {
    return restoreProjectsToBilling(this, input);
  }

  deleteProject(id: string, actor = DEFAULT_ACTOR) {
    return this.transaction((db) => {
      const project = db.projects.find((p) => p.id === id && !p.deletedAt);
      if (!project) throw new RuleError("NOT_FOUND", "Project was not found.", 404);
      project.deletedAt = now();
      project.updatedAt = now();
      project.updatedBy = actor;
      log(db, actor, "project.delete", "project", project.id, project.name);
    });
  }

  createInvoice(input: CreateInvoiceInput) {
    return this.transaction(async (db) => {
      const actor = input.actor ?? "Billing Staff";
      const requestedInvoiceNumber = input.invoiceNumber?.trim();
      let invoiceNumber = requestedInvoiceNumber || autoInvoiceNumber();
      if (!input.billingItemIds?.length) {
        throw new RuleError("INVALID", "Select at least one item.", 400);
      }
      const hasNumber = (candidate: string) =>
        db.invoices.some(
          (i) =>
            i.status !== "VOID" &&
            typeof i.invoiceNumber === "string" &&
            i.invoiceNumber.toLowerCase() === candidate.toLowerCase(),
        );
      while (!requestedInvoiceNumber && hasNumber(invoiceNumber)) invoiceNumber = autoInvoiceNumber();
      const duplicate = hasNumber(invoiceNumber)
        ? db.invoices.find(
            (i) =>
              i.status !== "VOID" &&
              typeof i.invoiceNumber === "string" &&
              i.invoiceNumber.toLowerCase() === invoiceNumber.toLowerCase(),
          )
        : undefined;
      if (duplicate) {
        throw new RuleError(
          "DUPLICATE_INVOICE_NUMBER",
          `Invoice ${duplicate.invoiceNumber} already exists (${duplicate.invoiceDate}).`,
        );
      }

      const items = input.billingItemIds.map((id) => requireItem(db, id));
      for (const item of items) {
        if (isHistoricalRecord(item)) {
          throw new RuleError("HISTORY_READ_ONLY", "Imported history is read-only.");
        }
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
        if (item.amount === null) {
          throw new RuleError("PRICE_REQUIRED", `"${item.description}" still needs a billing price.`);
        }
        // Belt and braces: the gate is enforced here too, not just in the UI.
        if (project.billingReadiness !== "READY" && !isProductionComplete(item)) {
          throw new RuleError(
            "NOT_DELIVERED",
            `"${item.description}" has not been completed yet.`,
          );
        }
        if (project.billingReadiness !== "READY" && item.type === "PRINT" && !isPrintPriceConfirmed(item)) {
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

      const amount = money(items.reduce((sum, i) => sum + (i.amount ?? 0), 0));
      let exchangeRate;
      try {
        exchangeRate = await ensureCurrentExchangeRate(db);
      } catch (error) {
        if (error instanceof ExchangeRateUnavailableError) {
          throw new RuleError("EXCHANGE_RATE_UNAVAILABLE", error.message, 503);
        }
        throw error;
      }
      const invoice: Invoice = {
        id: newId(),
        clientId: input.clientId,
        invoiceNumber,
        invoiceDate: input.invoiceDate || today(),
        amount,
        exchangeRate: exchangeRate.rate,
        exchangeRateSource: exchangeRate.source,
        exchangeRateEffectiveDate: exchangeRate.effectiveDate,
        exchangeRateFetchedAt: exchangeRate.fetchedAt,
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

}
