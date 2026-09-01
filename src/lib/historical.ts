import { flowStatus, isHistoricalRecord, monthKey, sum } from "@/lib/derive";
import type { BillingItem, Client, Project } from "@/lib/types";

export interface HistoricalGroup {
  projectId: string;
  project: Project;
  client: Client;
  items: BillingItem[];
  amount: number;
  months: string[];
  statuses: ReturnType<typeof flowStatus>[];
}

/** Groups imported rows by project without changing any source facts. */
export function groupHistoricalItems(
  items: BillingItem[],
  projectById: Map<string, Project>,
  clientById: Map<string, Client>,
): HistoricalGroup[] {
  const grouped = new Map<string, BillingItem[]>();
  for (const item of items) {
    if (!isHistoricalRecord(item)) continue;
    const list = grouped.get(item.projectId);
    if (list) list.push(item);
    else grouped.set(item.projectId, [item]);
  }

  return Array.from(grouped)
    .flatMap(([projectId, projectItems]) => {
      const project = projectById.get(projectId);
      const client = project ? clientById.get(project.clientId) : undefined;
      if (!project || !client) return [];
      const months = Array.from(
        new Set(projectItems.map((item) => item.historicalMonth ?? monthKey(project.date))),
      ).sort();
      return [{
        projectId,
        project,
        client,
        items: projectItems,
        amount: sum(projectItems),
        months,
        statuses: Array.from(new Set(projectItems.map(flowStatus))),
      }];
    })
    .sort((a, b) => {
      const monthOrder = (b.months.at(-1) ?? "").localeCompare(a.months.at(-1) ?? "");
      return monthOrder || a.project.name.localeCompare(b.project.name);
    });
}

export function historicalMonth(item: BillingItem, project: Project): string {
  return item.historicalMonth ?? monthKey(project.date);
}
