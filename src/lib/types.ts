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
export type UserRole = "DESIGNER" | "BILLING" | "ACCOUNTING" | "PRINTING" | "ADMIN";
export const PRICE_REVIEW_STATUSES = ["NOT_REQUIRED", "REVIEW_REQUIRED", "CONFIRMED"] as const;
export type PriceReviewStatus = (typeof PRICE_REVIEW_STATUSES)[number];
export const BILLING_READINESS = ["AUTO", "READY", "IN_PROGRESS"] as const;
export type BillingReadiness = (typeof BILLING_READINESS)[number];
/** The stored source of a line's Final price (V5). */
export type FinalMode = "AUTO" | "MANUAL";

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
  /** Optional override used by Billing V2 without changing production status. */
  billingReadiness?: BillingReadiness;
  /**
   * Money already received for this project before it is billed. Null (and
   * a row written before the column existed) means no deposit. Payment
   * information only: it never changes a cost or a price.
   */
  depositAmount?: number | null;
}

export interface ServiceType {
  id: string;
  key: string;
  name: string;
  active: boolean;
  createdAt: string;
}

export interface BillingItem {
  id: string;
  projectId: string;
  description: string;
  type: ItemType;
  /**
   * Which service was sold, named by the application's service registry.
   * Null on rows written before the column existed; the registry falls back
   * to `type` for those. See src/lib/billing-v2/services.ts.
   */
  serviceType?: string | null;
  quantity: number;
  unitPrice: number;
  /** quantity x unitPrice unless a custom price was entered. */
  /** NULL means no billing price has been entered; 0 is an explicit free price. */
  amount: number | null;
  customAmount: boolean;
  productionStatus: ProductionStatus;
  billingStatus: BillingStatus;
  /** Terminal production timestamp for either a physical delivery or creative completion. */
  deliveredAt?: string | null;
  /** Actor who marked the item delivered or completed. */
  deliveredBy?: string | null;
  invoiceId?: string | null;
  /** Month bucket retained for imported history whose exact work date is unknown. */
  historicalMonth?: string | null;
  /** Printing-only specification and price certainty fields. */
  printSize?: string | null;
  /** Total printing cost, kept separate from the Billing selling price. */
  printCost?: number | null;
  /**
   * A markup chosen by hand for this line, in percent (35 = +35%). Null (and
   * a row written before the column existed) uses the 50 / 40 / 30 band.
   */
  markupOverride?: number | null;
  /**
   * Where the Final comes from, stored explicitly (V5). AUTO follows
   * Recommended; MANUAL is a price a person chose and is never moved by a
   * cost or markup change. Absent on older rows: see `resolveFinalMode`.
   */
  finalMode?: FinalMode | null;
  priceReviewStatus?: PriceReviewStatus | null;
  suggestedUnitPrice?: number | null;
  suggestedAmount?: number | null;
  priceSource?: string | null;
  priceReason?: string | null;
  priceConfirmedBy?: string | null;
  priceConfirmedAt?: string | null;
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
  /** The NBC USD/KHR snapshot used when this invoice was issued. */
  exchangeRate?: number | null;
  exchangeRateSource?: string | null;
  exchangeRateEffectiveDate?: string | null;
  exchangeRateFetchedAt?: string | null;
  status: InvoiceStatus;
  paymentDate?: string | null;
  paymentSlip?: string | null;
  receiptStatus: ReceiptStatus;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface ExchangeRate {
  id: string;
  currencyPair: "USD/KHR";
  rate: number;
  source: "NBC";
  effectiveDate: string;
  fetchedAt: string;
}

export interface ExchangeRateFailure {
  id: string;
  source: "NBC";
  effectiveDate: string;
  attemptedAt: string;
  error: string;
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
  exchangeRates: ExchangeRate[];
  exchangeRateFailures: ExchangeRateFailure[];
  serviceTypes: ServiceType[];
  /** V5 only (absent on older stores and on Supabase). */
  projectPayments?: ProjectPayment[];
  clientTaxProfiles?: ClientTaxProfile[];
  taxInvoices?: TaxInvoiceRecord[];
  /** V5 invoice management. */
  customers?: Customer[];
  products?: Product[];
  billingAllocations?: BillingAllocation[];
  invoicePayments?: InvoicePayment[];
  invoiceRevisions?: InvoiceRevision[];
}

/* ------------------------------------------------------------- V5 accounting */

/**
 * Money received against a project. A deposit is one kind of payment; the
 * balance is always Final Total − every payment that is not voided.
 */
export type ProjectPaymentKind = "DEPOSIT" | "PARTIAL" | "FINAL";

export interface ProjectPayment {
  id: string;
  projectId: string;
  kind: ProjectPaymentKind;
  amount: number;
  paidOn: string; // yyyy-mm-dd
  note?: string | null;
  createdAt: string;
  createdBy: string;
  voidedAt?: string | null;
  voidedBy?: string | null;
}

/** The legal identity a Tax Invoice is addressed to. One per client. */
export interface ClientTaxProfile {
  clientId: string;
  companyNameEn: string;
  companyNameKm: string;
  addressEn: string;
  addressKm: string;
  telephone: string;
  vatin: string;
  updatedAt: string;
  updatedBy: string;
}

/**
 * One printed line of a Tax Invoice (an Invoice Item). It is a snapshot: a
 * later change to the billing line or the product never reaches it.
 */
export interface TaxInvoiceLine {
  /** The billing line it bills (allocated from); null for a free line. */
  billingItemId: string | null;
  /** The Product Master entry it was picked from, if any. */
  productId?: string | null;
  productCode?: string | null;
  description: string;
  quantity: number;
  unit?: string | null;
  unitPrice: number;
  /** Line amount. From a billing line it is the amount allocated from it. */
  amount: number;
}

/* ------------------------------------------------------- invoice management */

/**
 * Customer Master. One per client (same id): the client is who the work is
 * for, the customer is the legal identity an invoice is addressed to.
 */
export interface Customer {
  id: string;
  customerCode: string;
  companyNameEn: string;
  companyNameKm: string;
  addressEn: string;
  addressKm: string;
  telephone: string;
  vatin: string;
  contactPerson: string;
  email: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface Product {
  id: string;
  productCode: string;
  description: string;
  defaultUnitPrice: number | null;
  unit: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

/**
 * How much of a billing line one invoice bills. Many-to-many: several lines
 * on one invoice, one line over several invoices. Never deleted — a cancelled
 * or edited invoice voids its allocations.
 */
export interface BillingAllocation {
  id: string;
  billingItemId: string;
  invoiceId: string;
  amount: number;
  createdAt: string;
  createdBy: string;
  voidedAt?: string | null;
  voidedBy?: string | null;
}

/** Money received for an invoice. A deposit is one kind. Voided, never deleted. */
export type InvoicePaymentKind = "DEPOSIT" | "PAYMENT";

export interface InvoicePayment {
  id: string;
  invoiceId: string;
  kind: InvoicePaymentKind;
  amount: number;
  paidOn: string;
  note?: string | null;
  createdAt: string;
  createdBy: string;
  voidedAt?: string | null;
  voidedBy?: string | null;
  voidReason?: string | null;
}

export type InvoiceRevisionAction = "ISSUE" | "EDIT" | "CANCEL";

/** The audit trail of an invoice: each change keeps what was there before. */
export interface InvoiceRevision {
  id: string;
  invoiceId: string;
  revision: number;
  action: InvoiceRevisionAction;
  changedAt: string;
  changedBy: string;
  reason: string | null;
  /** The invoice as it was before this change; null for ISSUE. */
  previousSnapshot: TaxInvoiceRecord | null;
}

export type DiscountType = "FIXED" | "PERCENT";
export interface InvoiceDiscount {
  type: DiscountType;
  /** Dollars for FIXED, percent for PERCENT. */
  value: number;
}

/**
 * An issued Tax Invoice. Everything printed on it is copied in at issue time,
 * so a later edit to the project, the client or the rate never changes it.
 */
export interface TaxInvoiceRecord {
  id: string;
  /** The project it was raised from; the first one when it bills several. */
  projectId: string;
  projectIds?: string[];
  clientId: string;
  /** The internal ledger entry that billed the project's lines. */
  ledgerInvoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  status: "ISSUED" | "CANCELLED";
  customer: Omit<ClientTaxProfile, "clientId" | "updatedAt" | "updatedBy">;
  project: { name: string; note: string };
  lines: TaxInvoiceLine[];
  vatApplicable: boolean;
  vatPercent: number;
  subtotalUsd: number;
  /** Invoice-level discount; absent on invoices issued before discounts existed. */
  discount?: InvoiceDiscount | null;
  discountUsd?: number;
  /** Discount/VAT order the totals were calculated with (only when discounted). */
  discountPolicy?: "DISCOUNT_BEFORE_VAT" | "DISCOUNT_AFTER_VAT" | null;
  /** Subtotal − discount: the amount VAT is charged on. */
  taxableUsd?: number;
  vatUsd: number;
  totalUsd: number;
  exchangeRate: number;
  exchangeRateSource: "NBC" | "MANUAL";
  exchangeRateEffectiveDate: string | null;
  /**
   * How the rate was established for the invoice date: EXACT (NBC rate with
   * valid_date = invoice date), IN_EFFECT (NBC rate whose valid_date precedes
   * the invoice date and that NBC still reported as current on or after it),
   * or MANUAL (entered because no NBC rate could be established). Absent on
   * invoices issued before this was recorded.
   */
  exchangeRateBasis?: "EXACT" | "IN_EFFECT" | "MANUAL";
  /** The invoice date the rate was established for. */
  exchangeRateForDate?: string;
  totalKhr: number;
  /** Deposit shown on the invoice (Grand Total − Deposit = Balance Due). */
  depositUsd?: number;
  issuedAt: string;
  issuedBy: string;
  /** 1 at issue; each edit adds one. Absent on older invoices (= 1). */
  revision?: number;
  updatedAt?: string;
  updatedBy?: string;
  note?: string | null;
  cancelledAt?: string | null;
  cancelledBy?: string | null;
  cancellationReason?: string | null;
}

/** Everything the UI needs, in one round trip. */
export interface Snapshot {
  clients: Client[];
  projects: Project[];
  billingItems: BillingItem[];
  invoices: Invoice[];
  invoiceItems: InvoiceItem[];
  users: User[];
  serviceTypes: ServiceType[];
  /** Latest successful NBC rate, used for current operational estimates. */
  exchangeRate: ExchangeRate | null;
  /** Last successful official API check, including a future effective-date response. */
  exchangeRateLastCheckedAt: string | null;
  mode: "local" | "supabase";
  /** Which slice of the data this snapshot contains, given the viewer's role. */
  scope: { production: boolean; billing: boolean; payment: boolean; printing?: boolean };
  /** V5 accounting data; absent outside V5. */
  projectPayments?: ProjectPayment[];
  clientTaxProfiles?: ClientTaxProfile[];
  taxInvoices?: TaxInvoiceRecord[];
  customers?: Customer[];
  products?: Product[];
  billingAllocations?: BillingAllocation[];
  invoicePayments?: InvoicePayment[];
  invoiceRevisions?: InvoiceRevision[];
  /** Stored NBC history (rate for an invoice date). */
  exchangeRates?: ExchangeRate[];
}
