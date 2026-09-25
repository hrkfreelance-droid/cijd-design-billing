/**
 * Billing V2 has two states and one shape.
 *
 *   Billing  — current work, waiting to be billed
 *   Archive  — work that has been billed, kept to look at
 *
 * Everything on both screens is Client → Project → Line item. These functions
 * turn a snapshot into exactly that, so no component does its own grouping,
 * summing or readiness decision. The server uses the same functions to check
 * that what a person selected is what the screen showed them.
 */
import { isHistoricalRecord, isProductionComplete } from "@/lib/derive";
import type { BillingItem, Client, Project, Snapshot } from "@/lib/types";
import { markupForCost, printSellingPriceFromCost, projectBalance, roundCents, type ProjectBalance } from "./pricing";
import { isCostPriced, serviceForItem, type ServiceDefinition } from "./services";

export interface BoardItem {
  item: BillingItem;
  service: ServiceDefinition;
  /** Total cost of bought-in work; null when the service is not cost-priced or no cost is known. */
  cost: number | null;
  /** `cost` ÷ quantity — always derived, never stored; null under the same conditions as `cost`. */
  unitCost: number | null;
  /**
   * The price the cost rule suggests, from the *total* cost and the line's
   * markup (its manual override, else the band); null when not cost-priced.
   */
  recommended: number | null;
  /**
   * The default markup band behind `recommended`, as a fraction of cost
   * (0.5 = +50%). Named `margin` for the V2 screens that read it.
   */
  margin: number | null;
  /**
   * The final price per unit: the stored unit price when it belongs to the
   * stored total at this quantity, otherwise total ÷ quantity to the cent.
   * Null while the price is pending.
   */
  finalUnitPrice: number | null;
  /** The final price differs from the recommendation because a person chose it. */
  manual: boolean;
  /** Final billing. Null is "price pending" — never the same thing as $0. */
  amount: number | null;
}

/** Why a project cannot be billed yet. Null means it can. */
export type Blocker = "PRICE" | "PRODUCTION" | "PRINT_PRICE" | "REVIEW" | "NO_ITEMS" | "STATUS";

export interface BoardProject {
  id: string;
  name: string;
  note: string;
  date: string;
  clientId: string;
  items: BoardItem[];
  /** Sum of the lines that have a price. Only a real total when `pricePendingCount` is 0. */
  total: number;
  /** Sum of the printing cost on the lines. */
  costTotal: number;
  /** The first thing standing between this project and a bill. */
  blocker: Blocker | null;
  /** The line that blocker came from, so the reason can name its service. */
  blockedBy: BoardItem | null;
  billingReadiness: Project["billingReadiness"];
  pricePendingCount: number;
  /** Final total split into deposit received and what is left to collect. */
  balance: ProjectBalance;
}

export interface BoardGroup<T extends BoardProject = BoardProject> {
  client: Client;
  projects: T[];
  /** Sum of the projects' priced lines. */
  total: number;
  /** Some line in this group has no price yet, so `total` is incomplete. */
  pending: boolean;
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
  readyCount: number;
  inProgressCount: number;
  /** Printing cost on everything not billed yet — what the print shop is owed for. */
  printCostOutstanding: number;
}

export interface ArchiveProject extends BoardProject {
  /** When this work was billed. */
  billedAt: string | null;
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

/** DAISHIN is billed from its own system; it never appears on these screens. */
const EXCLUDED_CLIENTS = new Set(["DAISHIN"]);

function isVisibleClient(client: Client | undefined): client is Client {
  return !!client && !EXCLUDED_CLIENTS.has(client.name);
}

/** Only clients a new project may be started for. */
export function selectableClients(clients: Client[]): Client[] {
  return clients
    .filter((client) => client.active && isVisibleClient(client))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function toBoardItem(item: BillingItem, snapshot?: Pick<Snapshot, "serviceTypes">): BoardItem {
  const service = serviceForItem(item, snapshot?.serviceTypes ?? []);
  const costPriced = isCostPriced(service);
  const cost = costPriced ? (item.printCost ?? null) : null;
  const unitCost = cost == null || item.quantity <= 0 ? null : cost / item.quantity;
  const override = costPriced ? (item.markupOverride ?? null) : null;
  const recommended = cost == null ? null : printSellingPriceFromCost(cost, override);
  return {
    item,
    service,
    cost,
    unitCost,
    recommended,
    margin: cost == null ? null : markupForCost(cost, override),
    finalUnitPrice: storedFinalUnitPrice(item),
    manual: costPriced && item.amount != null && recommended != null && item.amount !== recommended,
    amount: item.amount,
  };
}

/**
 * Existing rows keep whatever unit price they were saved with. It is trusted
 * only when it still reproduces the stored total at the stored quantity, so an
 * older row whose unit price was never maintained falls back to total ÷ qty.
 */
export function storedFinalUnitPrice(item: Pick<BillingItem, "amount" | "unitPrice" | "quantity">): number | null {
  if (item.amount == null || !(item.quantity > 0)) return null;
  const unit = Number(item.unitPrice);
  if (Number.isFinite(unit) && unit > 0 && roundCents(unit * item.quantity) === roundCents(item.amount)) {
    return roundCents(unit);
  }
  return roundCents(item.amount / item.quantity);
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

/**
 * Where a project sits, in the order a person would reason about it:
 *
 *   no lines          → In progress ("No items yet")
 *   a price pending   → In progress ("Price pending") — always, whatever else
 *   moved by hand     → where it was put
 *   otherwise (AUTO)  → ready once every line is finished and confirmed
 */
export function readinessOf(
  readiness: Project["billingReadiness"],
  items: BoardItem[],
): { blocker: Blocker | null; blockedBy: BoardItem | null } {
  if (items.length === 0) return { blocker: "NO_ITEMS", blockedBy: null };
  const unpriced = items.find((entry) => entry.amount === null);
  if (unpriced) return { blocker: "PRICE", blockedBy: unpriced };
  if (readiness === "IN_PROGRESS") return { blocker: "STATUS", blockedBy: null };
  if (readiness === "READY") return { blocker: null, blockedBy: null };
  return projectBlocker(items);
}

export function sumItems(items: BoardItem[]): number {
  return roundCents(items.reduce((total, entry) => total + (entry.amount ?? 0), 0));
}

function sumCost(items: BoardItem[]): number {
  return roundCents(items.reduce((total, entry) => total + (entry.cost ?? 0), 0));
}

export function toBoardProject(
  project: Project,
  items: BillingItem[],
  snapshot: Pick<Snapshot, "serviceTypes">,
): BoardProject {
  const boardItems = items
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((item) => toBoardItem(item, snapshot));
  const readiness = project.billingReadiness ?? "AUTO";
  const { blocker, blockedBy } = readinessOf(readiness, boardItems);
  const total = sumItems(boardItems);
  return {
    id: project.id,
    name: project.name,
    note: project.note ?? "",
    date: project.date,
    clientId: project.clientId,
    items: boardItems,
    total,
    costTotal: sumCost(boardItems),
    blocker,
    blockedBy,
    billingReadiness: readiness,
    pricePendingCount: boardItems.filter((entry) => entry.amount === null).length,
    balance: projectBalance(total, project.depositAmount ?? null),
  };
}

function itemsByProject(items: BillingItem[]): Map<string, BillingItem[]> {
  const byProject = new Map<string, BillingItem[]>();
  for (const item of items) {
    const list = byProject.get(item.projectId);
    if (list) list.push(item);
    else byProject.set(item.projectId, [item]);
  }
  return byProject;
}

function toGroups<T extends BoardProject>(snapshot: Snapshot, projects: T[]): BoardGroup<T>[] {
  const clientById = new Map(snapshot.clients.map((client) => [client.id, client]));
  const byClient = new Map<string, T[]>();
  for (const project of projects) {
    const list = byClient.get(project.clientId);
    if (list) list.push(project);
    else byClient.set(project.clientId, [project]);
  }
  return Array.from(byClient, ([clientId, list]) => ({ client: clientById.get(clientId), list }))
    .filter((entry): entry is { client: Client; list: T[] } => isVisibleClient(entry.client))
    .map(({ client, list }) => ({
      client,
      projects: list,
      total: roundCents(list.reduce((total, project) => total + project.total, 0)),
      pending: list.some((project) => project.pricePendingCount > 0),
    }))
    .sort((a, b) => a.client.name.localeCompare(b.client.name));
}

/** Every current project waiting to be billed, one entry each. */
export function pendingProjects(snapshot: Snapshot): BoardProject[] {
  const clientById = new Map(snapshot.clients.map((client) => [client.id, client]));
  const pending = itemsByProject(snapshot.billingItems.filter(isPending));
  const current = itemsByProject(snapshot.billingItems.filter(isCurrentWork));
  return snapshot.projects
    .filter((project) => !project.deletedAt)
    .filter((project) => isVisibleClient(clientById.get(project.clientId)))
    .filter((project) => project.createdBy.trim().toLowerCase() !== "import")
    // A project is waiting when it has unbilled work, or when it has no work
    // at all yet (just created). Fully billed projects live in Archive.
    .filter((project) => pending.has(project.id) || !current.has(project.id))
    .map((project) => toBoardProject(project, pending.get(project.id) ?? [], snapshot))
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

/** Everything waiting to be billed, split by whether it can be billed yet. */
export function billingBoard(snapshot: Snapshot): BoardSections {
  const projects = pendingProjects(snapshot);
  const ready = projects.filter((project) => project.blocker === null);
  const inProgress = projects.filter((project) => project.blocker !== null);
  return {
    ready: toGroups(snapshot, ready),
    inProgress: toGroups(snapshot, inProgress),
    readyTotal: roundCents(ready.reduce((total, project) => total + project.total, 0)),
    readyCount: ready.length,
    inProgressCount: inProgress.length,
    printCostOutstanding: roundCents(projects.reduce((total, project) => total + project.costTotal, 0)),
  };
}

/**
 * What V2 has billed, most recently billed first.
 *
 * Deliberately not a history of everything ever invoiced — the imported
 * archive stays where it is rather than being pulled into a screen whose job
 * is to show what this system did.
 */
export function archiveBoard(snapshot: Snapshot): BoardGroup<ArchiveProject>[] {
  const billed = itemsByProject(snapshot.billingItems.filter(isArchived));
  const invoiceById = new Map(snapshot.invoices.map((invoice) => [invoice.id, invoice]));

  const projects: ArchiveProject[] = snapshot.projects
    .filter((project) => !project.deletedAt && billed.has(project.id))
    .map((project) => toBoardProject(project, billed.get(project.id)!, snapshot))
    .map((project) => ({ ...project, blocker: null, blockedBy: null, billedAt: billedDate(project.items, invoiceById) }))
    .sort((a, b) => (b.billedAt ?? "").localeCompare(a.billedAt ?? "") || a.name.localeCompare(b.name));

  return toGroups(snapshot, projects);
}

/** The billing date comes from the ledger entry the work was billed on. */
function billedDate(
  items: BoardItem[],
  invoiceById: Map<string, { invoiceDate: string | null; createdAt: string }>,
): string | null {
  let latest: string | null = null;
  for (const { item } of items) {
    const invoice = item.invoiceId ? invoiceById.get(item.invoiceId) : undefined;
    const date = invoice?.invoiceDate ?? invoice?.createdAt.slice(0, 10) ?? null;
    if (date && (!latest || date > latest)) latest = date;
  }
  return latest;
}

export function boardTotal(groups: { total: number }[]): number {
  return roundCents(groups.reduce((total, group) => total + group.total, 0));
}
