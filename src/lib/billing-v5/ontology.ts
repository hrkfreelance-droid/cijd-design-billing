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
  const payments = (data.invoicePayments ?? []).filter((payment) => payment.invoiceId === invoice.id);
  return { ...collection(invoice.status === "CANCELLED" ? 0 : invoice.totalUsd, payments), payments };
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
 * The official NBC rate for a date: the newest stored rate on or before it
 * (weekends and holidays use the last working day), but never one more than
 * `maxAgeDays` older than the date — then there is no official rate for it.
 */
export function rateForDate(rates: readonly ExchangeRate[], date: string, maxAgeDays = 7): ExchangeRate | null {
  const candidates = rates
    .filter((rate) => rate.source === "NBC" && rate.currencyPair === "USD/KHR" && rate.effectiveDate <= date)
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || b.fetchedAt.localeCompare(a.fetchedAt));
  const best = candidates[0];
  if (!best) return null;
  const age = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${best.effectiveDate}T00:00:00Z`)) / 86_400_000;
  return age <= maxAgeDays ? best : null;
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
