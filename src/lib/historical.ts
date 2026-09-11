import { flowStatus, isHistoricalRecord, sum } from "@/lib/derive";
import type { BillingItem, Client, Invoice, Project } from "@/lib/types";

export interface HistoricalGroup {
  projectId: string;
  project: Project;
  client: Client;
  items: BillingItem[];
  amount: number;
  months: string[];
  statuses: ReturnType<typeof flowStatus>[];
}

/** The newest month represented by a project, used for archive ordering. */
export function latestHistoricalMonth(group: Pick<HistoricalGroup, "months">): string {
  return group.months.reduce(
    (latest, month) => (month > latest ? month : latest),
    "",
  );
}

/** Keep archive groups newest-first without mutating the source collection. */
export function sortHistoricalGroups(groups: HistoricalGroup[]): HistoricalGroup[] {
  return [...groups].sort((a, b) => {
    const monthOrder = latestHistoricalMonth(b).localeCompare(latestHistoricalMonth(a));
    return monthOrder || a.project.name.localeCompare(b.project.name);
  });
}

/** An invoice's archive date is payment-first, then invoice date. */
export function archiveInvoiceDate(invoice: Pick<Invoice, "paymentDate" | "invoiceDate">): string {
  return invoice.paymentDate || invoice.invoiceDate || "";
}

/** Sort invoice rows newest-first without changing repository order. */
export function sortArchiveInvoices(invoices: Invoice[]): Invoice[] {
  return [...invoices].sort((a, b) => {
    const dateOrder = archiveInvoiceDate(b).localeCompare(archiveInvoiceDate(a));
    return dateOrder || b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id);
  });
}

/** Groups imported rows by project without changing any source facts. */
export function groupHistoricalItems(
  items: BillingItem[],
  projectById: Map<string, Project>,
  clientById: Map<string, Client>,
): HistoricalGroup[] {
  const grouped = new Map<string, BillingItem[]>();
  for (const item of items) {
    // An empty CSV item name remains in the source data, but has no useful
    // archive row. Filtering here keeps Designer, Office, and Accounting in
    // sync without deleting or rewriting that source record.
    if (!isHistoricalRecord(item) || !item.description.trim()) continue;
    const list = grouped.get(item.projectId);
    if (list) list.push(item);
    else grouped.set(item.projectId, [item]);
  }

  const groups = Array.from(grouped)
    .flatMap(([projectId, projectItems]) => {
      const project = projectById.get(projectId);
      const client = project ? clientById.get(project.clientId) : undefined;
      if (!project || !client) return [];
      const months = Array.from(
        new Set(projectItems.map(historicalMonth).filter(Boolean)),
      ).sort((a, b) => b.localeCompare(a));
      return [{
        projectId,
        project,
        client,
        items: [...projectItems].sort((a, b) =>
          historicalMonth(b).localeCompare(historicalMonth(a)),
        ),
        amount: sum(projectItems),
        months,
        statuses: Array.from(new Set(projectItems.map(flowStatus))),
      }];
    });

  return sortHistoricalGroups(groups);
}

export function historicalMonth(item: BillingItem): string {
  // Do not derive a historical month from the project's creation date. The
  // imported month is the only historical date fact; a missing value stays
  // blank rather than becoming an invented day/month.
  return item.historicalMonth ?? "";
}
