/**
 * Billing V2 has two states and one shape.
 *
 *   Billing  — current work, waiting to be billed
 *   Archive  — work that has been billed, kept to look at
 *
 * Everything on both screens is Client → Project → Line item. These functions
 * turn a snapshot into exactly that, so no component does its own grouping.
 */
import { isHistoricalRecord, isProductionComplete } from "@/lib/derive";
import type { BillingItem, Client, Project, Snapshot } from "@/lib/types";
import { printSellingPriceFromCost } from "./pricing";
import { isCostPriced, serviceForItem, SERVICES, type ServiceDefinition } from "./services";

export interface BoardItem {
  item: BillingItem;
  service: ServiceDefinition;
  /** The price the cost rule suggests; null when the service is not cost-priced. */
  recommended: number | null;
  /** The final price was chosen by a person, so a cost edit must not move it. */
  manual: boolean;
  amount: number | null;
}

/** Why a line cannot be billed yet. Null means it can. */
export type Blocker = "PRICE" | "PRODUCTION" | "PRINT_PRICE" | "REVIEW" | "NO_ITEMS" | "STATUS";

export interface BoardProject {
  id: string;
  name: string;
  note: string;
  date: string;
  clientId: string;
  items: BoardItem[];
  total: number;
  /** The first thing standing between this project and a bill. */
  blocker: Blocker | null;
  /** The line that blocker came from, so the reason can name its service. */
  blockedBy: BoardItem | null;
  billingReadiness: Project["billingReadiness"];
  pricePendingCount: number;
  serviceBreakdown: { service: ServiceDefinition; total: number; costTotal: number | null }[];
}

export interface BoardGroup {
  client: Client;
  projects: BoardProject[];
  total: number;
  itemCount: number;
}

/**
 * The Billing screen in two parts: what can be billed now, and what cannot
 * yet. Both are the same list, so the split is the only thing that separates
 * them.
 */
export interface BoardSections {
  ready: BoardGroup[];
  inProgress: BoardGroup[];
  /** Only billable work counts towards the figure at the top of the screen. */
  readyTotal: number;
}

export interface ArchiveProject extends BoardProject {
  /** When this work was billed. */
  billedAt: string | null;
}

export interface ArchiveGroup {
  client: Client;
  projects: ArchiveProject[];
  total: number;
}

export function isBilled(item: BillingItem): boolean {
  return item.billingStatus === "INVOICED" || item.billingStatus === "PAID";
}

/**
 * V2 works on current operational records only.
 *
 * Rows imported from the old spreadsheets are evidence of past work: they are
 * neither waiting to be billed nor part of what V2 has billed. They stay in
 * the database, and remain visible on the original Billing screens.
 */
export function isCurrentWork(item: BillingItem): boolean {
  return !item.deletedAt && !isHistoricalRecord(item);
}

/** Current work that has not been billed yet. */
export function isPending(item: BillingItem): boolean {
  return isCurrentWork(item) && !isBilled(item);
}

/** Current work that V2 has billed. */
export function isArchived(item: BillingItem): boolean {
  return isCurrentWork(item) && isBilled(item);
}

export function toBoardItem(item: BillingItem, snapshot?: Snapshot): BoardItem {
  const service = serviceForItem(item, snapshot?.serviceTypes ?? []);
  const costPriced = isCostPriced(service);
  return {
    item,
    service,
    recommended:
      costPriced && item.printCost != null ? printSellingPriceFromCost(item.printCost) : null,
    manual: costPriced ? item.customAmount : false,
    amount: item.amount,
  };
}

/**
 * Read from the item's own state — never from its name. A line is billable
 * when it is priced, finished, and (for bought-in work) has a confirmed price.
 */
export function itemBlocker(entry: BoardItem): Blocker | null {
  const { item } = entry;
  if (item.amount === null) return "PRICE";
  if (!isProductionComplete(item)) return "PRODUCTION";
  if (isCostPriced(entry.service) && item.priceReviewStatus !== "CONFIRMED") return "PRINT_PRICE";
  if (item.billingStatus !== "READY_TO_INVOICE") return "REVIEW";
  return null;
}

/**
 * A project is billed whole or not at all, so one unfinished line holds the
 * whole project back. Partial billing is deliberately not a thing here.
 */
export function projectBlocker(items: BoardItem[]): { blocker: Blocker | null; blockedBy: BoardItem | null } {
  for (const entry of items) {
    const blocker = itemBlocker(entry);
    if (blocker) return { blocker, blockedBy: entry };
  }
  return { blocker: null, blockedBy: null };
}

export function sumItems(items: BoardItem[]): number {
  return Math.round(items.reduce((total, entry) => total + (entry.amount ?? 0), 0) * 100) / 100;
}

function groupByProject(
  snapshot: Snapshot,
  items: BillingItem[],
): Map<string, BillingItem[]> {
  const known = new Set(snapshot.projects.map((project) => project.id));
  const byProject = new Map<string, BillingItem[]>();
  for (const item of items) {
    if (!known.has(item.projectId)) continue;
    const list = byProject.get(item.projectId);
    if (list) list.push(item);
    else byProject.set(item.projectId, [item]);
  }
  return byProject;
}

function buildProjects(
  snapshot: Snapshot,
  byProject: Map<string, BillingItem[]>,
  includeEmpty = false,
): BoardProject[] {
  const projectById = new Map(snapshot.projects.map((project) => [project.id, project]));
  const projectIds = includeEmpty ? snapshot.projects.map((project) => project.id) : Array.from(byProject.keys());
  return projectIds.flatMap((projectId) => {
    const project = projectById.get(projectId)!;
    if (!project) return [];
    const items = byProject.get(projectId) ?? [];
    const boardItems = items
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((item) => toBoardItem(item, snapshot));
    const serviceTotals = new Map<
      string,
      { service: ServiceDefinition; total: number; costTotal: number | null }
    >();
    for (const entry of boardItems) {
      const itemCost = isCostPriced(entry.service) ? (entry.item.printCost ?? null) : null;
      const current = serviceTotals.get(entry.service.key);
      if (current) {
        current.total += entry.amount ?? 0;
        if (isCostPriced(entry.service)) {
          current.costTotal = current.costTotal === null || itemCost === null
            ? null
            : current.costTotal + itemCost;
        }
      } else {
        serviceTotals.set(entry.service.key, {
          service: entry.service,
          total: entry.amount ?? 0,
          costTotal: itemCost,
        });
      }
    }
    const readiness = project.billingReadiness ?? "AUTO";
    const blocker = boardItems.length === 0
      ? "NO_ITEMS" as const
      : readiness === "IN_PROGRESS"
        ? "STATUS" as const
        : readiness === "READY"
          ? boardItems.find((entry) => entry.item.amount === null)
            ? "PRICE" as const
            : null
          : projectBlocker(boardItems).blocker;
    const blockedBy = blocker === "PRICE"
      ? boardItems.find((entry) => entry.item.amount === null) ?? null
      : blocker && blocker !== "NO_ITEMS" && blocker !== "STATUS"
        ? projectBlocker(boardItems).blockedBy
        : null;
    return [{
      id: project.id,
      name: project.name,
      note: project.note ?? "",
      date: project.date,
      clientId: project.clientId,
      items: boardItems,
      total: sumItems(boardItems),
      blocker,
      blockedBy,
      billingReadiness: readiness,
      pricePendingCount: boardItems.filter((entry) => entry.item.amount === null).length,
      serviceBreakdown: Array.from(serviceTotals.values())
        .sort((a, b) => {
          const aOrder = SERVICES.findIndex((service) => service.key === a.service.key);
          const bOrder = SERVICES.findIndex((service) => service.key === b.service.key);
          return (aOrder === -1 ? Number.MAX_SAFE_INTEGER : aOrder) -
            (bOrder === -1 ? Number.MAX_SAFE_INTEGER : bOrder);
        })
        .map((entry) => ({
          ...entry,
          total: Math.round(entry.total * 100) / 100,
          costTotal: entry.costTotal === null ? null : Math.round(entry.costTotal * 100) / 100,
        })),
    }];
  });
}

function groupByClient<T extends BoardProject>(
  snapshot: Snapshot,
  projects: T[],
): { client: Client; projects: T[] }[] {
  const clientById = new Map(snapshot.clients.map((client) => [client.id, client]));
  const byClient = new Map<string, T[]>();
  for (const project of projects) {
    const list = byClient.get(project.clientId);
    if (list) list.push(project);
    else byClient.set(project.clientId, [project]);
  }
  return Array.from(byClient, ([clientId, list]) => ({
    client: clientById.get(clientId)!,
    projects: list,
  })).filter((group) => group.client);
}

function toGroups(snapshot: Snapshot, projects: BoardProject[]): BoardGroup[] {
  return groupByClient(snapshot, projects)
    .map(({ client, projects: list }) => ({
      client,
      projects: list,
      total: list.reduce((total, project) => total + project.total, 0),
      itemCount: list.reduce((count, project) => count + project.items.length, 0),
    }))
    .sort((a, b) => b.total - a.total || a.client.name.localeCompare(b.client.name));
}

/** Everything waiting to be billed, split by whether it can be billed yet. */
export function billingBoard(snapshot: Snapshot, clientId: string | null): BoardSections {
  const pending = snapshot.billingItems.filter(isPending);
  const pendingByProject = groupByProject(snapshot, pending);
  const activeByProject = new Map<string, number>();
  for (const item of snapshot.billingItems.filter(isCurrentWork)) {
    activeByProject.set(item.projectId, (activeByProject.get(item.projectId) ?? 0) + 1);
  }
  const candidateProjects = snapshot.projects.filter((project) => {
    const client = snapshot.clients.find((candidate) => candidate.id === project.clientId);
    return client?.name !== "DAISHIN" && project.createdBy.trim().toLowerCase() !== "import" &&
      (pendingByProject.has(project.id) || !activeByProject.has(project.id));
  });
  const projects = buildProjects(
    { ...snapshot, projects: candidateProjects },
    pendingByProject,
    true,
  )
    .filter((project) => !clientId || project.clientId === clientId)
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));

  const ready = projects.filter((project) => project.blocker === null);
  return {
    ready: toGroups(snapshot, ready),
    inProgress: toGroups(snapshot, projects.filter((project) => project.blocker !== null)),
    readyTotal: Math.round(ready.reduce((total, project) => total + project.total, 0) * 100) / 100,
  };
}

/**
 * What V2 has billed, most recently billed first.
 *
 * Deliberately not a history of everything ever invoiced — the imported
 * archive stays where it is rather than being pulled into a screen whose job
 * is to show what this system did.
 */
export function archiveBoard(snapshot: Snapshot, clientId: string | null): ArchiveGroup[] {
  const billed = snapshot.billingItems.filter(isArchived);
  const invoiceById = new Map(snapshot.invoices.map((invoice) => [invoice.id, invoice]));

  const projects: ArchiveProject[] = buildProjects(snapshot, groupByProject(snapshot, billed))
    .filter((project) => project.items.length > 0)
    .filter((project) => snapshot.clients.find((client) => client.id === project.clientId)?.name !== "DAISHIN")
    .filter((project) => project.items.every((entry) => entry.item.createdBy.trim().toLowerCase() !== "import"))
    .filter((project) => !clientId || project.clientId === clientId)
    .map((project) => ({
      ...project,
      billedAt: billedDate(project.items, invoiceById),
    }))
    .sort((a, b) => (b.billedAt ?? "").localeCompare(a.billedAt ?? "") || a.name.localeCompare(b.name));

  return groupByClient(snapshot, projects)
    .map(({ client, projects: list }) => ({
      client,
      projects: list,
      total: list.reduce((total, project) => total + project.total, 0),
    }))
    .sort((a, b) => a.client.name.localeCompare(b.client.name));
}

/** The billing date comes from the ledger entry the work was billed on. */
function billedDate(
  items: BoardItem[],
  invoiceById: Map<string, { invoiceDate: string | null; createdAt: string }>,
): string | null {
  for (const { item } of items) {
    const invoice = item.invoiceId ? invoiceById.get(item.invoiceId) : undefined;
    const date = invoice?.invoiceDate ?? invoice?.createdAt.slice(0, 10);
    if (date) return date;
  }
  return null;
}

export function boardTotal(groups: { total: number }[]): number {
  return Math.round(groups.reduce((total, group) => total + group.total, 0) * 100) / 100;
}
