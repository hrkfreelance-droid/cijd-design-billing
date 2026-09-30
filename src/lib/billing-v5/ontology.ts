/**
 * CIJD invoice management — the objects and how they relate.
 *
 *   Customer (= client) ─┬─ Projects ── Billing lines
 *                        └─ Invoices ─┬─ Invoice Items (snapshots)
 *                                     ├─ Billing Allocations ── Billing lines
 *                                     ├─ Payments
 *                                     └─ Revisions
 *
 * Every derived number (what a billing line has left to bill, what an invoice
 * has collected) is computed here from the records, never stored twice.
 * Pure: the server and the screens use the same functions.
 */
import { pendingProjects } from "../billing-v2/board";
import { isHistoricalRecord } from "../derive";
import { phnomPenhDate } from "../exchange-rate";
import type {
  BillingAllocation,
  BillingItem,
  ClientTaxProfile,
  Customer,
  ExchangeRate,
  InvoicePayment,
  Snapshot,
  TaxInvoiceRecord,
} from "../types";
import { billingRemaining, collection, type BillingRemaining, type Collection } from "./calculation";

type Data = Pick<Snapshot, "clients" | "projects" | "billingItems" | "serviceTypes"> & {
  billingAllocations?: BillingAllocation[];
  taxInvoices?: TaxInvoiceRecord[];
  invoicePayments?: InvoicePayment[];
  customers?: Customer[];
  clientTaxProfiles?: ClientTaxProfile[];
  projectPayments?: Snapshot["projectPayments"];
  invoices?: Snapshot["invoices"];
};

export interface BillingState extends BillingRemaining {
  item: BillingItem;
  /** Valid allocations, oldest first. */
  allocations: BillingAllocation[];
  invoiceIds: string[];
  /** Billed in V3 ("Mark billed") before V5 invoices existed: nothing left to bill here. */
  legacyBilled: boolean;
  /** Can go on a new invoice now: ready to bill, or already partly invoiced, with money left. */
  eligible: boolean;
  state: "UNBILLED" | "PARTIALLY_INVOICED" | "FULLY_INVOICED" | "LEGACY_BILLED" | "NOT_READY";
}

export function allocationsFor(data: Data, billingItemId: string): BillingAllocation[] {
  return (data.billingAllocations ?? [])
    .filter((allocation) => allocation.billingItemId === billingItemId && !allocation.voidedAt)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Projects whose lines the Billing screen shows as ready to bill. */
export function readyProjectIds(data: Data): Set<string> {
  return new Set(
    pendingProjects(data as unknown as Snapshot)
      .filter((project) => project.blocker === null)
      .map((project) => project.id),
  );
}

export function billingState(data: Data, item: BillingItem, ready: Set<string> = readyProjectIds(data)): BillingState {
  const everAllocated = (data.billingAllocations ?? []).some((allocation) => allocation.billingItemId === item.id);
  const allocations = allocationsFor(data, item.id);
  const billed = item.billingStatus === "INVOICED" || item.billingStatus === "PAID";
  const legacyBilled = billed && !everAllocated;
  const amounts = legacyBilled
    ? { originalUsd: item.amount ?? 0, invoicedUsd: item.amount ?? 0, remainingUsd: 0 }
    : billingRemaining(item.amount ?? 0, allocations);
  const current = !item.deletedAt && !isHistoricalRecord(item) && item.amount != null;
  const readyNow = ready.has(item.projectId) || allocations.length > 0;
  const eligible = current && !legacyBilled && amounts.remainingUsd > 0 && readyNow;
  const state: BillingState["state"] = legacyBilled
    ? "LEGACY_BILLED"
    : amounts.remainingUsd === 0 && allocations.length > 0
      ? "FULLY_INVOICED"
      : allocations.length > 0
        ? "PARTIALLY_INVOICED"
        : readyNow
          ? "UNBILLED"
          : "NOT_READY";
  return { item, ...amounts, allocations, invoiceIds: [...new Set(allocations.map((a) => a.invoiceId))], legacyBilled, eligible, state };
}

/** Every billing line that can go on an invoice now. */
export function eligibleBilling(data: Data): BillingState[] {
  const ready = readyProjectIds(data);
  return data.billingItems.map((item) => billingState(data, item, ready)).filter((state) => state.eligible);
}

export function invoiceCollection(data: Data, invoice: TaxInvoiceRecord): Collection & { payments: InvoicePayment[] } {
  const own = (data.invoicePayments ?? []).filter((payment) => payment.invoiceId === invoice.id);
  const payments = [...own, ...ledgerPaid(data, invoice, own)];
  return { ...collection(invoice.status === "CANCELLED" ? 0 : invoice.totalUsd, payments), payments };
}

/** Id prefix of the read-only payment derived from a ledger entry marked paid. */
export const LEDGER_PAYMENT_PREFIX = "ledger:";

/**
 * An invoice whose ledger entry was marked PAID before invoice management
 * (Billing's "confirm payment") is collected in full: that status is the
 * recorded fact. It shows as one read-only payment for what is otherwise
 * outstanding; nothing is written, and the ledger entry is not touched.
 */
function ledgerPaid(data: Data, invoice: TaxInvoiceRecord, own: readonly InvoicePayment[]): InvoicePayment[] {
  if (invoice.status === "CANCELLED" || !invoice.ledgerInvoiceId) return [];
  const ledger = (data.invoices ?? []).find((entry) => entry.id === invoice.ledgerInvoiceId);
  if (!ledger || ledger.status !== "PAID") return [];
  const paid = collection(invoice.totalUsd, own);
  if (paid.outstandingUsd <= 0) return [];
  return [{
    id: `${LEDGER_PAYMENT_PREFIX}${ledger.id}`,
    invoiceId: invoice.id,
    kind: "PAYMENT",
    amount: paid.outstandingUsd,
    paidOn: ledger.paymentDate ?? "",
    note: ledger.paymentSlip ?? null,
    createdAt: ledger.updatedAt,
    createdBy: ledger.updatedBy,
    voidedAt: null,
    voidedBy: null,
  }];
}

/** The Customer Master record for a client, or one derived from what V5 already knows. */
export function customerFor(data: Data, clientId: string): Customer {
  const stored = (data.customers ?? []).find((customer) => customer.id === clientId);
  if (stored) return stored;
  const client = data.clients.find((entry) => entry.id === clientId);
  const profile = (data.clientTaxProfiles ?? []).find((entry) => entry.clientId === clientId);
  return {
    id: clientId,
    customerCode: "",
    companyNameEn: profile?.companyNameEn || client?.name || "",
    companyNameKm: profile?.companyNameKm ?? "",
    addressEn: profile?.addressEn ?? "",
    addressKm: profile?.addressKm ?? "",
    telephone: profile?.telephone ?? "",
    vatin: profile?.vatin ?? "",
    contactPerson: "",
    email: "",
    active: client?.active ?? true,
    createdAt: client?.createdAt ?? "",
    updatedAt: profile?.updatedAt ?? "",
    updatedBy: profile?.updatedBy ?? "",
  };
}

/**
 * The official NBC USD/KHR rate for an invoice date — never a guess.
 *
 * NBC/MEF's API (`data.mef.gov.kh/api/v1/realtime-api/exchange-rate`) only
 * answers "the latest published rate", with `valid_date` = the date from which
 * that rate applies (it can be tomorrow's working day, published the afternoon
 * before). It cannot be asked for a past date. Each stored rate keeps in
 * `fetchedAt` the last time NBC still reported it as its latest rate
 * (`fetchAndStoreLatestOfficialRate` overwrites it on every successful check).
 *
 * 1. EXACT: a stored rate whose valid_date is the invoice date.
 * 2. IN_EFFECT: the newest stored rate with valid_date before the invoice date,
 *    ONLY when NBC was seen still reporting it as its latest rate on or after
 *    the invoice date (Phnom Penh). Then no other rate applied that day
 *    (weekends and holidays, the existing rule in HANDOFF_NBC_RATE_OPERATIONS).
 * 3. Otherwise null: the rate cannot be established. There is no
 *    look-back window — Accounting enters the rate by hand (MANUAL).
 */
export type RateBasis = "EXACT" | "IN_EFFECT";

export function officialRateForDate(rates: readonly ExchangeRate[], date: string): { rate: ExchangeRate; basis: RateBasis } | null {
  const official = rates.filter((rate) => rate.source === "NBC" && rate.currencyPair === "USD/KHR" && Number.isFinite(rate.rate) && rate.rate > 0);
  const exact = official
    .filter((rate) => rate.effectiveDate === date)
    .sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt))[0];
  if (exact) return { rate: exact, basis: "EXACT" };
  const previous = official
    .filter((rate) => rate.effectiveDate < date)
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || b.fetchedAt.localeCompare(a.fetchedAt))[0];
  if (!previous) return null;
  const seen = Date.parse(previous.fetchedAt);
  if (!Number.isFinite(seen) || phnomPenhDate(new Date(seen)) < date) return null;
  return { rate: previous, basis: "IN_EFFECT" };
}

export function rateForDate(rates: readonly ExchangeRate[], date: string): ExchangeRate | null {
  return officialRateForDate(rates, date)?.rate ?? null;
}

/** Deposits received on a project (V3 deposit + V5 project payments) not yet put on an invoice. */
export function unappliedProjectDeposit(data: Data & { projectPayments?: Snapshot["projectPayments"] }, projectIds: readonly string[]): number {
  let cents = 0;
  for (const projectId of projectIds) {
    const project = data.projects.find((entry) => entry.id === projectId);
    cents += Math.round((project?.depositAmount ?? 0) * 100);
    for (const payment of data.projectPayments ?? []) {
      if (payment.projectId === projectId && !payment.voidedAt && payment.kind === "DEPOSIT") cents += Math.round(payment.amount * 100);
    }
  }
  // Already shown on invoices raised from these projects.
  for (const invoice of data.taxInvoices ?? []) {
    if (invoice.status !== "ISSUED") continue;
    const ids = invoice.projectIds ?? [invoice.projectId];
    if (!ids.some((id) => projectIds.includes(id))) continue;
    cents -= Math.round((invoice.depositUsd ?? 0) * 100);
  }
  return Math.max(cents, 0) / 100;
}
