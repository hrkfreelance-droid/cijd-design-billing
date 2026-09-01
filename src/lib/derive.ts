import type { BillingItem, FlowStatus, Invoice, Snapshot } from "@/lib/types";

/** Most-actionable-first. Also the order Today uses. */
const PRIORITY: FlowStatus[] = [
  "NEEDS_REVIEW",
  "READY_TO_INVOICE",
  "IN_PROGRESS",
  "INVOICED",
  "PAID",
];

/**
 * One label per row. The two stored statuses are an implementation detail —
 * on screen there is a single line of progress.
 */
export function flowStatus(item: BillingItem): FlowStatus {
  if (item.billingStatus === "NEEDS_REVIEW") return "NEEDS_REVIEW";
  if (item.billingStatus === "PAID") return "PAID";
  if (item.billingStatus === "INVOICED") return "INVOICED";
  if (item.billingStatus === "READY_TO_INVOICE") return "READY_TO_INVOICE";
  return "IN_PROGRESS";
}

export function isDelivered(item: BillingItem): boolean {
  return item.productionStatus === "DELIVERED";
}

/** Both physical delivery and creative completion release an item to billing. */
export function isProductionComplete(item: BillingItem): boolean {
  return item.productionStatus === "DELIVERED" || item.productionStatus === "COMPLETED";
}

/** Invoiced and paid work remains visible as history, but cannot be edited. */
export function isBillingLocked(item: Pick<BillingItem, "billingStatus">): boolean {
  return item.billingStatus === "INVOICED" || item.billingStatus === "PAID";
}

/** Designer's ready tab keeps completed work visible until it is invoiced. */
export function isDesignerReady(item: BillingItem): boolean {
  return isProductionComplete(item) && !isBillingLocked(item);
}

export type ProductionAction = "DELIVER" | "COMPLETE";

/** Printing is physically delivered; every other creative item is completed. */
export function productionAction(item: Pick<BillingItem, "type">): ProductionAction {
  return item.type === "PRINT" ? "DELIVER" : "COMPLETE";
}

export function terminalProductionStatus(
  item: Pick<BillingItem, "type">,
  finished: boolean,
): BillingItem["productionStatus"] {
  if (!finished) return "IN_PROGRESS";
  return productionAction(item) === "DELIVER" ? "DELIVERED" : "COMPLETED";
}

/** Imported rows are historical evidence, not current designer workload. */
export function isHistoricalRecord(item: BillingItem): boolean {
  return item.createdBy.trim().toLowerCase() === "import";
}

/** Current operational work is identified by the explicit import marker. */
export function isOperationalRecord(item: BillingItem): boolean {
  return !isHistoricalRecord(item);
}

export type PriceState = "CONFIRMED" | "SUGGESTED" | "PENDING";

/**
 * Explicit certainty for current print work. Null is kept as a compatibility
 * path for rows created before the printing migration; imported rows remain
 * historical evidence and are never treated as current review work.
 */
export function printPriceReviewState(item: BillingItem): "NOT_REQUIRED" | "REVIEW_REQUIRED" | "CONFIRMED" {
  if (item.type !== "PRINT") return "NOT_REQUIRED";
  if (isHistoricalRecord(item)) return "NOT_REQUIRED";
  // A current PRINT row is billable only after an explicit human confirmation.
  // NULL/NOT_REQUIRED are legacy or invalid current values, so fail closed until
  // the controlled Printing review flow writes CONFIRMED.
  return item.priceReviewStatus === "CONFIRMED" ? "CONFIRMED" : "REVIEW_REQUIRED";
}

export function isPrintPriceConfirmed(item: BillingItem): boolean {
  return item.type !== "PRINT" || isHistoricalRecord(item) || printPriceReviewState(item) === "CONFIRMED";
}

/** Display-only price certainty derived from the existing billing facts. */
export function priceState(item: BillingItem): PriceState {
  if (item.type === "PRINT") {
    const review = printPriceReviewState(item);
    if (review === "REVIEW_REQUIRED") return item.amount > 0 ? "SUGGESTED" : "PENDING";
    if (review === "CONFIRMED") return "CONFIRMED";
    return item.amount > 0 ? "SUGGESTED" : "PENDING";
  }
  if (item.amount <= 0) return "PENDING";
  // Creative items do not use the Printing review enum. NEEDS_REVIEW is the
  // structured signal that their displayed amount still needs human review.
  return item.billingStatus === "NEEDS_REVIEW" ? "SUGGESTED" : "CONFIRMED";
}

/** Kept for older callers: a project is terminal when every live item is done. */
export function projectDelivered(items: BillingItem[]): boolean {
  return items.length > 0 && items.every(isProductionComplete);
}

export function projectStatus(items: BillingItem[]): FlowStatus | null {
  if (!items.length) return null;
  for (const status of PRIORITY) {
    if (items.some((item) => flowStatus(item) === status)) return status;
  }
  return null;
}

export function sum(items: { amount: number }[]): number {
  return Math.round(items.reduce((total, i) => total + i.amount, 0) * 100) / 100;
}

export interface Indexed {
  itemsByProject: Map<string, BillingItem[]>;
  projectById: Map<string, Snapshot["projects"][number]>;
  clientById: Map<string, Snapshot["clients"][number]>;
  itemsByInvoice: Map<string, BillingItem[]>;
  invoiceById: Map<string, Invoice>;
}

export function index(snapshot: Snapshot): Indexed {
  const itemsByProject = new Map<string, BillingItem[]>();
  for (const item of snapshot.billingItems) {
    const list = itemsByProject.get(item.projectId);
    if (list) list.push(item);
    else itemsByProject.set(item.projectId, [item]);
  }
  const itemsByInvoice = new Map<string, BillingItem[]>();
  const byId = new Map(snapshot.billingItems.map((i) => [i.id, i]));
  for (const link of snapshot.invoiceItems) {
    const item = byId.get(link.billingItemId);
    if (!item) continue;
    const list = itemsByInvoice.get(link.invoiceId);
    if (list) list.push(item);
    else itemsByInvoice.set(link.invoiceId, [item]);
  }
  return {
    itemsByProject,
    projectById: new Map(snapshot.projects.map((p) => [p.id, p])),
    clientById: new Map(snapshot.clients.map((c) => [c.id, c])),
    itemsByInvoice,
    invoiceById: new Map(snapshot.invoices.map((i) => [i.id, i])),
  };
}

/** Items belonging to the selected client (null = all clients). */
export function scopedItems(
  snapshot: Snapshot,
  idx: Indexed,
  clientId: string | null,
): BillingItem[] {
  if (!clientId) return snapshot.billingItems;
  return snapshot.billingItems.filter(
    (item) => idx.projectById.get(item.projectId)?.clientId === clientId,
  );
}

export function statusCounts(items: BillingItem[]): Record<FlowStatus, number> {
  const counts: Record<FlowStatus, number> = {
    IN_PROGRESS: 0,
    READY_TO_INVOICE: 0,
    INVOICED: 0,
    PAID: 0,
    NEEDS_REVIEW: 0,
  };
  for (const item of items) counts[flowStatus(item)] += 1;
  return counts;
}

export function monthKey(date: string): string {
  return date.slice(0, 7);
}
