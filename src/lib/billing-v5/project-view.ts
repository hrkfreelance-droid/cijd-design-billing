import { pendingProjects, storedFinalUnitPrice, type BoardProject } from "../billing-v2/board";
import { isCostPriced, serviceForItem } from "../billing-v2/services";
import { isHistoricalRecord, isProductionComplete } from "../derive";
import type { BillingItem, Invoice, Project, Snapshot, TaxInvoiceRecord } from "../types";
import { roundMoney } from "./calculation";
import { customerFor, eligibleBilling, invoiceCollection, LEDGER_PAYMENT_PREFIX } from "./ontology";

export const projectStatuses = ["progress", "ready", "unpaid", "completed", "all"] as const;
export type ProjectStatus = "progress" | "ready" | "completed";
export type ProjectCollection = "outstanding" | "partial" | "collected";
export type WorkKind = "design" | "print" | "other";

export interface ProjectInvoice {
  id: string;
  number: string | null;
  date: string | null;
  actor: string | null;
  usd: number;
  khr: number | null;
  outstanding: number;
  paid: boolean;
  cancelled: boolean;
  tax: boolean;
  due?: string | null;
}

export interface ProjectPaymentView {
  id: string;
  date: string | null;
  actor: string | null;
  amount: number;
  voided: boolean;
  invoiceId?: string;
  deposit?: boolean;
}

export interface ProjectView {
  project: Project;
  client: string;
  kinds: WorkKind[];
  items: { item: BillingItem; kind: WorkKind; unit: string | null; price: number | null }[];
  invoices: ProjectInvoice[];
  payments: ProjectPaymentView[];
  status: ProjectStatus;
  workComplete: boolean;
  collection: ProjectCollection | null;
  amount: number | null;
  estimatedKhr: number | null;
  archivedImport: boolean;
  readOnly: boolean;
  pending?: BoardProject;
  canIssue: boolean;
  search: string;
}

export function normalizeSearch(value: string): string {
  return value.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
}

export function matchesSearch(text: string, query: string): boolean {
  return normalizeSearch(query).split(" ").every((term) => text.includes(term));
}

export function projectMatches(project: ProjectView, query: string): boolean {
  return matchesSearch(project.search, query);
}

function addToIndex<T>(index: Map<string, T[]>, id: string, entry: T) {
  const list = index.get(id);
  if (list) list.push(entry);
  else index.set(id, [entry]);
}

function legacyInvoice(invoice: Invoice): ProjectInvoice {
  return {
    id: invoice.id, number: invoice.invoiceNumber, date: invoice.invoiceDate,
    actor: invoice.createdBy, usd: invoice.amount,
    khr: invoice.exchangeRate ? Math.round(invoice.amount * invoice.exchangeRate) : null,
    outstanding: invoice.status === "ISSUED" ? invoice.amount : 0, paid: invoice.status === "PAID",
    cancelled: invoice.status === "VOID", tax: false,
  };
}

export function taxInvoiceView(snapshot: Snapshot, invoice: TaxInvoiceRecord): ProjectInvoice {
  const money = invoiceCollection(snapshot, invoice);
  return {
    id: invoice.id, number: invoice.invoiceNumber, date: invoice.invoiceDate,
    actor: invoice.issuedBy, usd: invoice.totalUsd, khr: invoice.totalKhr,
    outstanding: money.outstandingUsd, paid: money.status === "PAID",
    cancelled: invoice.status === "CANCELLED", tax: true, due: invoice.dueDate,
  };
}

export function buildProjectViews(snapshot: Snapshot): ProjectView[] {
  const pending = new Map(pendingProjects(snapshot).map((project) => [project.id, project]));
  const issueIds = new Set(eligibleBilling(snapshot).map(({ item }) => item.projectId));
  const clients = new Map(snapshot.clients.map((client) => [client.id, client]));
  const itemsByProject = new Map<string, BillingItem[]>();
  const taxByProject = new Map<string, TaxInvoiceRecord[]>();
  const legacyByProject = new Map<string, Invoice[]>();
  const ledger = new Map(snapshot.invoices.map((invoice) => [invoice.id, invoice]));
  const paymentsByInvoice = new Map<string, NonNullable<Snapshot["payments"]>>();
  const projectPayments = new Map<string, NonNullable<Snapshot["projectPayments"]>>();
  const itemProjects = new Map<string, string>();
  const invoiceProjects = new Map<string, Set<string>>();
  const taxLedgerIds = new Set<string>();

  for (const item of snapshot.billingItems.filter((entry) => !entry.deletedAt)) {
    addToIndex(itemsByProject, item.projectId, item);
    itemProjects.set(item.id, item.projectId);
    if (item.invoiceId) addInvoiceProject(item.invoiceId, item.projectId);
  }
  for (const entry of snapshot.invoiceItems) {
    const id = itemProjects.get(entry.billingItemId);
    if (id) addInvoiceProject(entry.invoiceId, id);
  }
  for (const invoice of snapshot.taxInvoices ?? []) {
    if (invoice.ledgerInvoiceId) taxLedgerIds.add(invoice.ledgerInvoiceId);
    const ids = new Set([invoice.projectId, ...(invoice.projectIds ?? [])]);
    for (const line of invoice.lines) {
      const id = line.billingItemId ? itemProjects.get(line.billingItemId) : undefined;
      if (id) ids.add(id);
    }
    for (const id of ids) if (id) addToIndex(taxByProject, id, invoice);
  }
  for (const [invoiceId, projects] of invoiceProjects) {
    const invoice = ledger.get(invoiceId);
    if (invoice && !taxLedgerIds.has(invoiceId)) {
      for (const projectId of projects) addToIndex(legacyByProject, projectId, invoice);
    }
  }
  for (const payment of snapshot.payments ?? []) addToIndex(paymentsByInvoice, payment.invoiceId, payment);
  for (const payment of snapshot.projectPayments ?? []) addToIndex(projectPayments, payment.projectId, payment);

  function addInvoiceProject(invoiceId: string, projectId: string) {
    const projects = invoiceProjects.get(invoiceId) ?? new Set<string>();
    projects.add(projectId);
    invoiceProjects.set(invoiceId, projects);
  }

  const currentIds = new Set(snapshot.projects.map(({ id }) => id));
  const supplemental = (snapshot.legacyProjects ?? []).filter(({ project }) => !currentIds.has(project.id) && !project.deletedAt);
  const records = [
    ...snapshot.projects.filter((project) => !project.deletedAt).map((project) => ({
      project, client: clients.get(project.clientId), items: itemsByProject.get(project.id) ?? [],
      legacy: legacyByProject.get(project.id) ?? [], imported: false,
    })),
    ...supplemental.map(({ project, client, items, invoices }) => ({
      project, client: clients.get(client.id) ?? client, items, legacy: invoices, imported: true,
    })),
  ];
  const archivedPayments = new Map(supplemental.map(({ project, payments }) => [project.id, payments]));

  return records.filter(({ client }) => client?.name !== "DAISHIN").map(({ project, client, items, legacy, imported }) => {
    const tax = taxByProject.get(project.id) ?? [];
    const invoices = [...tax.map((invoice) => taxInvoiceView(snapshot, invoice)), ...legacy.map(legacyInvoice)]
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
    const payments: ProjectPaymentView[] = [];
    if (snapshot.scope.payment) {
      for (const invoice of tax) {
        const ledgerPayments = (paymentsByInvoice.get(invoice.ledgerInvoiceId) ?? []).filter((payment) => !payment.voidedAt);
        for (const entry of invoiceCollection(snapshot, invoice).payments) {
          if (entry.id.startsWith(LEDGER_PAYMENT_PREFIX) && ledgerPayments.length) {
            for (const payment of ledgerPayments) payments.push({
              id: payment.id, date: payment.paidAt, actor: payment.createdBy,
              amount: payment.amount, voided: false, invoiceId: invoice.id,
            });
          } else {
            payments.push({ id: entry.id, date: entry.paidOn || null, actor: entry.createdBy, amount: entry.amount,
              voided: Boolean(entry.voidedAt), deposit: entry.kind === "DEPOSIT", invoiceId: invoice.id });
          }
        }
      }
      for (const invoice of legacy) {
        const entries = imported
          ? (archivedPayments.get(project.id) ?? []).filter((payment) => payment.invoiceId === invoice.id)
          : paymentsByInvoice.get(invoice.id) ?? [];
        for (const entry of entries) payments.push({
          id: entry.id, date: entry.paidAt, actor: entry.createdBy, amount: entry.amount,
          voided: Boolean(entry.voidedAt), invoiceId: invoice.id,
        });
        if (entries.every((entry) => entry.voidedAt) && invoice.status === "PAID") payments.push({
          id: `ledger:${invoice.id}`, date: invoice.paymentDate ?? null, actor: invoice.updatedBy,
          amount: invoice.amount, voided: false, invoiceId: invoice.id,
        });
      }
      for (const entry of projectPayments.get(project.id) ?? []) payments.push({
        id: entry.id, date: entry.paidOn, actor: entry.createdBy, amount: entry.amount,
        voided: Boolean(entry.voidedAt), deposit: entry.kind === "DEPOSIT",
      });
      if (project.depositAmount && !tax.some((invoice) => (invoice.depositUsd ?? 0) > 0)) payments.push({
        id: `deposit:${project.id}`, date: null, actor: null, amount: project.depositAmount, voided: false, deposit: true,
      });
    }

    const lineUnits = new Map<string, string>();
    for (const invoice of tax.filter((entry) => entry.status === "ISSUED")) {
      const pricedLines = invoice.contractSnapshot?.lines ?? (invoice.invoiceKind === undefined || invoice.invoiceKind === "FULL" ? invoice.lines : []);
      for (const line of pricedLines) {
        if (line.billingItemId && line.unit) lineUnits.set(line.billingItemId, line.unit);
      }
    }
    const lines = items.map((item) => {
      const service = serviceForItem(item, snapshot.serviceTypes);
      const kind: WorkKind = isCostPriced(service) || item.type === "PRINT" ? "print"
        : item.type === "DESIGN" || item.type === "RESIZE" ? "design" : "other";
      return { item, kind, unit: lineUnits.get(item.id) ?? null, price: storedFinalUnitPrice(item) };
    });
    const kinds = [...new Set(lines.map(({ kind }) => kind))];
    const operational = pending.get(project.id);
    const canIssue = issueIds.has(project.id);
    const archivedImport = imported || items.length > 0 && items.every(isHistoricalRecord);
    const workComplete = archivedImport || items.length > 0 && items.every(
      (item) => isHistoricalRecord(item) || isProductionComplete(item),
    );
    const status: ProjectStatus = archivedImport ? "completed"
      : canIssue || operational?.blocker === null ? "ready"
      : operational || !workComplete ? "progress" : "completed";
    const activeInvoices = invoices.filter((invoice) => !invoice.cancelled);
    const hasOutstanding = activeInvoices.some((invoice) => invoice.outstanding > 0);
    const hasPayment = activeInvoices.some((invoice) => invoice.outstanding < invoice.usd);
    const collection: ProjectCollection | null = hasOutstanding ? (hasPayment ? "partial" : "outstanding")
      : activeInvoices.some((invoice) => invoice.paid) ? "collected" : null;
    const amount = items.some((item) => item.amount != null)
      ? roundMoney(items.reduce((sum, item) => sum + (item.amount ?? 0), 0)) : null;
    const customer = client?.name ?? "";
    const legal = client && clients.has(client.id) ? customerFor(snapshot, client.id) : null;
    return {
      project, client: customer, kinds, items: lines, invoices,
      payments: payments.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")),
      status, workComplete, collection, amount, archivedImport, readOnly: archivedImport || !operational,
      estimatedKhr: amount !== null && snapshot.exchangeRate && !archivedImport
        ? Math.round(amount * snapshot.exchangeRate.rate) : null,
      pending: archivedImport ? undefined : operational, canIssue,
      search: normalizeSearch([project.name, customer, legal?.companyNameEn, legal?.companyNameKm,
        ...items.map((item) => item.description), ...invoices.map((invoice) => invoice.number)].join(" ")),
    };
  });
}

export interface PriceEntry {
  view: ProjectView;
  id: string;
  name: string;
  date: string;
  quantity: number;
  unit: string | null;
  price: number;
}

export function priceHistory(projects: ProjectView[]): PriceEntry[] {
  return projects.flatMap((view) => view.items.flatMap(({ item, price, unit }) => {
    const recorded = view.archivedImport || item.billingStatus === "PAID" || item.billingStatus === "INVOICED";
    return recorded && price !== null ? [{
      view, id: item.id, name: item.description,
      date: item.historicalMonth || view.project.date,
      quantity: item.quantity, unit, price,
    }] : [];
  })).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

export function similarProjects(view: ProjectView, projects: ProjectView[]): ProjectView[] {
  const projectName = normalizeSearch(view.project.name);
  const itemNames = new Set(view.items.map(({ item }) => normalizeSearch(item.description)).filter(Boolean));
  return projects.flatMap((entry) => {
    if (entry.project.id === view.project.id || entry.amount == null ||
        (entry.status !== "completed" && entry.collection !== "outstanding" && entry.collection !== "partial")) return [];
    const name = normalizeSearch(entry.project.name);
    const score = (name === projectName ? 4 : name.includes(projectName) || projectName.includes(name) ? 2 : 0)
      + (entry.items.some(({ item }) => itemNames.has(normalizeSearch(item.description))) ? 3 : 0)
      + (entry.project.clientId === view.project.clientId ? 1 : 0);
    return score ? [{ entry, score }] : [];
  }).sort((a, b) => b.score - a.score || b.entry.project.date.localeCompare(a.entry.project.date))
    .slice(0, 8).map(({ entry }) => entry);
}
