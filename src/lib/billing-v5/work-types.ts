import { RuleError } from "@/lib/data/repository";
import { phnomPenhDate } from "@/lib/exchange-rate";
import type { Database, Project, Snapshot, TaxInvoiceRecord, WorkType } from "@/lib/types";

export const WORK_TYPES = ["DESIGN", "OTHER_BUSINESS"] as const;
export const workLabel = (type: WorkType) => type === "DESIGN" ? "Design" : "Other Business";
export const projectWorkType = (project: Pick<Project, "workType">): WorkType => project.workType ?? "DESIGN";

export function invoiceWorkTypes(snapshot: Pick<Snapshot, "projects">, invoice: TaxInvoiceRecord): WorkType[] {
  if (invoice.workTypes) return invoice.workTypes;
  const ids = invoice.projectIds?.length ? invoice.projectIds : [invoice.projectId];
  return [...new Set(ids.flatMap(id => {
    const project = snapshot.projects.find(p => p.id === id);
    return project ? [projectWorkType(project)] : [];
  }))];
}
export function invoiceArea(snapshot: Pick<Snapshot, "projects">, invoice: TaxInvoiceRecord): WorkType | "SHARED" {
  const types = invoiceWorkTypes(snapshot, invoice);
  return types.length === 1 ? types[0] : "SHARED";
}

/** All customers/rates stay shared; only work and its associated records are scoped. */
export function workSnapshot(snapshot: Snapshot, type: WorkType | "SHARED"): Snapshot {
  const projects = snapshot.projects.filter(p => type !== "SHARED" && projectWorkType(p) === type);
  const ids = new Set(projects.map(p => p.id));
  return {...snapshot, projects, billingItems: snapshot.billingItems.filter(i => ids.has(i.projectId)),
    taxInvoices: (snapshot.taxInvoices ?? []).filter(i => invoiceArea(snapshot, i) === type)};
}

export function createWorkProject(db: Database, input: {clientId: string; name: string; workType?: unknown}, actor: string): Project {
  const type = input.workType ?? "DESIGN";
  if (type !== "DESIGN" && type !== "OTHER_BUSINESS") throw new RuleError("INVALID", "Unknown work type.", 400);
  if (!input.name.trim()) throw new RuleError("INVALID", "Project name is required.", 400);
  if (!db.clients.some(c => c.id === input.clientId)) throw new RuleError("INVALID", "Unknown client.", 400);
  const at = new Date().toISOString();
  const project: Project = {id: crypto.randomUUID(), clientId: input.clientId, name: input.name.trim(), workType: type,
    date: phnomPenhDate(), createdAt: at, updatedAt: at, createdBy: actor, updatedBy: actor, deletedAt: null, billingReadiness: "AUTO"};
  db.projects.push(project);
  db.auditLogs.push({id: crypto.randomUUID(), at, actor, action: "project.create", entity: "project", entityId: project.id, detail: `${type}: ${project.name}`});
  return project;
}
