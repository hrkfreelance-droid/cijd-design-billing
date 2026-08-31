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

/** Imported rows are historical evidence, not current designer workload. */
export function isHistoricalRecord(item: BillingItem): boolean {
  return item.createdBy.trim().toLowerCase() === "import";
}

/** Current operational work is identified by the explicit import marker. */
export function isOperationalRecord(item: BillingItem): boolean {
  return !isHistoricalRecord(item);
}

export type PriceState = "CONFIRMED" | "SUGGESTED" | "PENDING";

/** Display-only price certainty derived from the existing billing facts. */
export function priceState(item: BillingItem): PriceState {
  const note = item.note?.toLowerCase() ?? "";
  if (item.amount <= 0 || /amount[^;,.]*unconfirmed|price[^;,.]*unknown/.test(note)) {
    return "PENDING";
  }
  if (
    item.billingStatus === "NEEDS_REVIEW" ||
    note.includes("suggested") ||
    note.includes("pricing review")
  ) {
    return "SUGGESTED";
  }
  return "CONFIRMED";
}

/** A project counts as delivered once every live item has been. */
export function projectDelivered(items: BillingItem[]): boolean {
  return items.length > 0 && items.every(isDelivered);
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
