/** Accounting may close commercial billing without issuing a tax document.
 * This is an internal "No invoice" record, not a Tax Invoice or payment.
 * Every action is atomic within Store.transaction and audited.
 */
import { RuleError } from "../data/repository";
import { isHistoricalRecord } from "../derive";
import type { Database, NoInvoiceIssue } from "../types";
import { billingState, readyProjectIds } from "./ontology";
import { roundMoney } from "./calculation";

const at = () => new Date().toISOString();
const uid = () => globalThis.crypto.randomUUID();

export function issueNoInvoice(db: Database, input: { clientId: string; billingItemIds: string[]; actor: string }): NoInvoiceIssue {
  if (!db.taxInvoices) throw new RuleError("NOT_FOUND", "No invoice is available only in V5.", 404);
  const ids = input.billingItemIds ?? [];
  if (!input.clientId || !Array.isArray(ids) || !ids.length || ids.length > 500 || new Set(ids).size !== ids.length) {
    throw new RuleError("INVALID", "Select one or more unique billing lines.", 400);
  }
  if (!db.clients.some((client) => client.id === input.clientId && client.active)) {
    throw new RuleError("INVALID", "Select an active customer.", 400);
  }
  const ready = readyProjectIds(db as never);
  const lines = ids.map((id) => {
    const item = db.billingItems.find((entry) => entry.id === id && !entry.deletedAt);
    const project = item && db.projects.find((entry) => entry.id === item.projectId && !entry.deletedAt);
    if (!item || !project) throw new RuleError("NOT_FOUND", "A selected line is no longer available.", 404);
    if (project.clientId !== input.clientId) throw new RuleError("DIFFERENT_CUSTOMER", "One selection may only include one customer.", 409);
    const state = billingState(db as never, item, ready);
    if (!state.eligible || state.remainingUsd <= 0 || !Number.isFinite(state.remainingUsd)) {
      throw new RuleError("ALREADY_INVOICED", "A line is no longer eligible. Refresh Accounting.", 409);
    }
    return { item, project, amount: state.remainingUsd };
  });
  const amountUsd = roundMoney(lines.reduce((sum, entry) => sum + entry.amount, 0));
  if (!(amountUsd > 0)) throw new RuleError("INVALID", "No amount is left.", 400);
  const issuedAt = at();
  const record: NoInvoiceIssue = {
    id: uid(),
    clientId: input.clientId,
    projectIds: [...new Set(lines.map(({ project }) => project.id))],
    amountUsd,
    issuedAt,
    issuedBy: input.actor,
    status: "ISSUED",
  };
  db.noInvoiceIssues ??= [];
  db.billingAllocations ??= [];
  db.noInvoiceIssues.push(record);
  for (const line of lines) {
    db.billingAllocations.push({
      id: uid(), billingItemId: line.item.id, invoiceId: record.id,
      amount: line.amount, createdAt: issuedAt, createdBy: input.actor,
    });
  }
  db.auditLogs.push({
    id: uid(), at: issuedAt, actor: input.actor, action: "no_invoice.issue",
    entity: "no_invoice", entityId: record.id,
    detail: `No invoice / ${record.projectIds.length} projects / USD ${amountUsd.toFixed(2)}`,
  });
  return record;
}

export function cancelNoInvoice(db: Database, id: string, actor: string): NoInvoiceIssue {
  const record = (db.noInvoiceIssues ?? []).find((entry) => entry.id === id);
  if (!record) throw new RuleError("NOT_FOUND", "No invoice record was not found.", 404);
  if (record.status !== "ISSUED") throw new RuleError("ALREADY_VOID", "Already reversed.", 409);
  const cancelledAt = at();
  const allocations = (db.billingAllocations ?? []).filter((entry) => entry.invoiceId === id && !entry.voidedAt);
  if (!allocations.length) throw new RuleError("INVALID", "No active allocations to restore.", 409);
  for (const entry of allocations) {
    entry.voidedAt = cancelledAt;
    entry.voidedBy = actor;
  }
  record.status = "CANCELLED";
  record.cancelledAt = cancelledAt;
  record.cancelledBy = actor;
  db.auditLogs.push({
    id: uid(), at: cancelledAt, actor, action: "no_invoice.cancel",
    entity: "no_invoice", entityId: record.id, detail: `USD ${record.amountUsd.toFixed(2)}`,
  });
  return record;
}

export function deleteUninvoicedV5Project(db: Database, id: string, actor: string): void {
  if (!db.taxInvoices) throw new RuleError("NOT_FOUND", "V5 only.", 404);
  const project = db.projects.find((entry) => entry.id === id && !entry.deletedAt);
  if (!project) throw new RuleError("NOT_FOUND", "Project was not found.", 404);
  const items = db.billingItems.filter((entry) => entry.projectId === id && !entry.deletedAt);
  const itemIds = new Set(items.map((item) => item.id));
  const hasInvoiceHistory =
    items.some((item) => isHistoricalRecord(item) || item.invoiceId || item.billingStatus === "INVOICED" || item.billingStatus === "PAID") ||
    (db.billingAllocations ?? []).some((entry) => itemIds.has(entry.billingItemId)) ||
    db.invoiceItems.some((entry) => itemIds.has(entry.billingItemId)) ||
    (db.taxInvoices ?? []).some((invoice) => invoice.projectId === id || invoice.projectIds?.includes(id)) ||
    (db.noInvoiceIssues ?? []).some((record) => record.projectIds.includes(id));
  const hasPayments = (project.depositAmount ?? 0) > 0 ||
    (db.projectPayments ?? []).some((payment) => payment.projectId === id);
  if (hasInvoiceHistory || hasPayments) {
    throw new RuleError("PROJECT_LOCKED", "Billed or paid projects cannot be deleted. Cancel or reverse the billing first; records are retained for audit.", 409);
  }
  const deletedAt = at();
  for (const item of items) {
    item.deletedAt = deletedAt;
    item.updatedAt = deletedAt;
    item.updatedBy = actor;
  }
  project.deletedAt = deletedAt;
  project.updatedAt = deletedAt;
  project.updatedBy = actor;
  db.auditLogs.push({
    id: uid(), at: deletedAt, actor, action: "project.delete",
    entity: "project", entityId: id,
    detail: `${project.name} / ${items.length} lines (soft delete)`,
  });
}
