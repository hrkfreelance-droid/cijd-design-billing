/**
 * Domain model for CIJD DESIGN Billing.
 *
 * The core rule: a *project* is the piece of work, a *billing item* is the thing
 * that gets invoiced. Items move through the status flow independently, so a
 * later add-on never rewrites an item that has already been billed.
 */

/**
 * Making the work and billing for it are two different things, tracked
 * separately: nothing can be invoiced until production is complete.
 *
 *   IN_PROGRESS / NOT_READY
 *     -> delivered/completed -> DELIVERED or COMPLETED / READY_TO_INVOICE
 *     -> invoiced  -> DELIVERED or COMPLETED / INVOICED
 *     -> paid      -> DELIVERED or COMPLETED / PAID
 */
export const PRODUCTION_STATUSES = ["IN_PROGRESS", "DELIVERED", "COMPLETED"] as const;
export type ProductionStatus = (typeof PRODUCTION_STATUSES)[number];

export const BILLING_STATUSES = [
  "NOT_READY",
  "READY_TO_INVOICE",
  "INVOICED",
  "PAID",
  "NEEDS_REVIEW",
] as const;
export type BillingStatus = (typeof BILLING_STATUSES)[number];

/** What a single row shows, once both statuses are folded together. */
export type FlowStatus =
  | "IN_PROGRESS"
  | "READY_TO_INVOICE"
  | "INVOICED"
  | "PAID"
  | "NEEDS_REVIEW";

export const ITEM_TYPES = ["DESIGN", "RESIZE", "PRINT", "OTHER"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export type InvoiceStatus = "ISSUED" | "PAID" | "VOID";
export type ReceiptStatus = "NOT_REQUIRED" | "PENDING" | "RECEIVED";
export type UserRole = "DESIGNER" | "BILLING" | "ACCOUNTING" | "ADMIN";

export interface Client {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
}

export interface Project {
  id: string;
  clientId: string;
  name: string;
  date: string; // yyyy-mm-dd — the work date, set server side on create
  note?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  deletedAt?: string | null;
}

export interface BillingItem {
  id: string;
  projectId: string;
  description: string;
  type: ItemType;
  quantity: number;
  unitPrice: number;
  /** quantity x unitPrice unless a custom price was entered. */
  amount: number;
  customAmount: boolean;
  productionStatus: ProductionStatus;
  billingStatus: BillingStatus;
  /** Terminal production timestamp for either a physical delivery or creative completion. */
  deliveredAt?: string | null;
  /** Actor who marked the item delivered or completed. */
  deliveredBy?: string | null;
  invoiceId?: string | null;
  note?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  deletedAt?: string | null;
}

export interface Invoice {
  id: string;
  clientId: string;
  /** Null is reserved for imported history where the number was unknown. */
  invoiceNumber: string | null;
  /** Null is reserved for imported history where the date was unknown. */
  invoiceDate: string | null; // yyyy-mm-dd
  amount: number;
  status: InvoiceStatus;
  paymentDate?: string | null;
  paymentSlip?: string | null;
  receiptStatus: ReceiptStatus;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface InvoiceItem {
  invoiceId: string;
  billingItemId: string;
}

export interface Payment {
  id: string;
  invoiceId: string;
  amount: number;
  /** Historical paid facts may have no recoverable payment date. */
  paidAt: string | null; // yyyy-mm-dd
  slip?: string | null;
  createdAt: string;
  createdBy: string;
  voidedAt?: string | null;
  voidedBy?: string | null;
}

export interface User {
  id: string;
  name: string;
  role: UserRole;
}

export type NotificationStatus = "PENDING" | "SENT" | "FAILED" | "SKIPPED";

/**
 * Delivery notifications are recorded before they are sent, so a Telegram
 * outage can never roll back a delivery — it just leaves something to resend.
 */
export interface Notification {
  id: string;
  kind: "DELIVERY";
  /** Same delivery, same key: prevents sending the message twice. */
  dedupeKey: string;
  projectId: string;
  text: string;
  status: NotificationStatus;
  attempts: number;
  lastError?: string | null;
  createdAt: string;
  sentAt?: string | null;
}

/** Remembers what a Telegram chat was last talking about. */
export interface TelegramSession {
  chatId: string;
  lastProjectId?: string | null;
  /** Projects offered for disambiguation, in the order they were listed. */
  candidateIds?: string[];
  pendingProjectName?: string | null;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  at: string;
  actor: string;
  action: string;
  entity: string;
  entityId: string;
  detail?: string;
}

export interface Database {
  clients: Client[];
  projects: Project[];
  billingItems: BillingItem[];
  invoices: Invoice[];
  invoiceItems: InvoiceItem[];
  payments: Payment[];
  users: User[];
  auditLogs: AuditLog[];
  telegramSessions: TelegramSession[];
  notifications: Notification[];
}

/** Everything the UI needs, in one round trip. */
export interface Snapshot {
  clients: Client[];
  projects: Project[];
  billingItems: BillingItem[];
  invoices: Invoice[];
  invoiceItems: InvoiceItem[];
  users: User[];
  mode: "local" | "supabase";
  /** Which slice of the data this snapshot contains, given the viewer's role. */
  scope: { production: boolean; billing: boolean; payment: boolean };
}
