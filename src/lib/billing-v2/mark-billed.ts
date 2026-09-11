/**
 * "Mark as billed" — the only state change Billing V2 makes.
 *
 * The screen shows current work; pressing the button says that work has been
 * billed. Underneath, the existing ledger still records it against the client,
 * because that is what the database's money rules are written against. V2 just
 * never asks a person about invoices, numbers or intermediate statuses.
 *
 * Written against the Repository interface, so the local store and Supabase
 * behave identically and each step keeps its own rules and audit trail.
 */
import {
  RuleError,
  type MarkBilledInput,
  type MarkBilledResult,
  type Repository,
  type RestoreBilledInput,
} from "@/lib/data/repository";
import { todayIso } from "@/lib/format";
import { pendingProjects } from "./board";

/**
 * The slice of the repository each step needs, so the guarded repository can
 * run these operations without being cast to something it is not.
 */
export type BillingRunOps = Pick<
  Repository,
  | "getSnapshot"
  | "createInvoice"
  | "setProjectBillingReadiness"
>;
export type RestoreOps = Pick<Repository, "getSnapshot" | "voidInvoice">;
export type DeleteProjectOps = RestoreOps &
  Pick<Repository, "deleteBillingItem" | "deleteProject">;

/**
 * Bills exactly what the Billing screen shows as ready — nothing more.
 *
 * Every selected project is checked against the same readiness rule the
 * screen uses before anything is written, so a stale screen can never bill
 * half a selection. A project marked ready by hand has its lines brought back
 * in line with that decision first (a line added or re-priced after the
 * decision is otherwise still "not ready" in the ledger).
 */
export async function markProjectsBilled(
  repo: BillingRunOps,
  input: MarkBilledInput,
): Promise<MarkBilledResult> {
  const projectIds = new Set((input.projectIds ?? []).filter(Boolean));
  if (!projectIds.size) {
    throw new RuleError("NO_ITEMS", "Select the work to bill first.", 400);
  }

  const snapshot = await repo.getSnapshot();
  const byId = new Map(pendingProjects(snapshot).map((project) => [project.id, project]));
  for (const id of projectIds) {
    const project = byId.get(id);
    if (!project) {
      const exists = snapshot.projects.some((candidate) => candidate.id === id && !candidate.deletedAt);
      throw exists
        ? new RuleError("NO_ITEMS", "There is nothing left to bill here.", 400)
        : new RuleError("NOT_FOUND", "That project was not found.", 404);
    }
    if (project.blocker === "PRICE") {
      throw new RuleError("PRICE_REQUIRED", `Set every price on "${project.name}" before billing it.`, 400);
    }
    if (project.blocker) {
      throw new RuleError("NOT_READY", `"${project.name}" is not ready to bill yet.`, 409);
    }
  }

  for (const id of projectIds) {
    if (byId.get(id)!.billingReadiness === "READY") {
      await repo.setProjectBillingReadiness(id, "READY", input.actor);
    }
  }

  // One ledger entry per project, so a single project can later be brought
  // back to Billing on its own without disturbing anything billed beside it.
  // Readiness is a billing decision: this never changes production status.
  const billedOn = input.billedOn || todayIso();
  let itemCount = 0;
  let total = 0;
  for (const id of projectIds) {
    const project = byId.get(id)!;
    await repo.createInvoice({
      clientId: project.clientId,
      invoiceDate: billedOn,
      billingItemIds: project.items.map((entry) => entry.item.id),
      actor: input.actor,
    });
    itemCount += project.items.length;
    total += project.total;
  }

  return {
    projectCount: projectIds.size,
    itemCount,
    total: Math.round(total * 100) / 100,
    billedOn,
  };
}

/**
 * Archive is a record, not a cage.
 *
 * Bringing a project back cancels the ledger entry it was billed on, which
 * returns its items to Billing with their prices intact and editable again.
 * An entry shared with work outside the selection is left alone and reported,
 * rather than silently un-billing someone else's project.
 */
export async function restoreProjectsToBilling(
  repo: RestoreOps,
  input: RestoreBilledInput,
): Promise<MarkBilledResult> {
  const projectIds = new Set((input.projectIds ?? []).filter(Boolean));
  if (!projectIds.size) {
    throw new RuleError("NO_ITEMS", "Select the work to bring back first.", 400);
  }

  const snapshot = await repo.getSnapshot();
  const billed = snapshot.billingItems.filter(
    (item) => !item.deletedAt && projectIds.has(item.projectId) && item.invoiceId,
  );
  if (!billed.length) {
    throw new RuleError("NO_ITEMS", "This work has not been billed.", 400);
  }

  const invoiceIds = new Set(billed.map((item) => item.invoiceId as string));
  for (const invoiceId of invoiceIds) {
    const shared = snapshot.billingItems.some(
      (item) =>
        item.invoiceId === invoiceId && !item.deletedAt && !projectIds.has(item.projectId),
    );
    if (shared) {
      throw new RuleError(
        "PROJECT_LOCKED",
        "This was billed together with another project. Bring both back at once.",
      );
    }
    await repo.voidInvoice(invoiceId, input.actor);
  }

  return {
    projectCount: new Set(billed.map((item) => item.projectId)).size,
    itemCount: billed.length,
    total: Math.round(billed.reduce((total, item) => total + (item.amount ?? 0), 0) * 100) / 100,
    billedOn: todayIso(),
  };
}

/**
 * Deletes a project and the work on it.
 *
 * Anything already billed is brought back to Billing first, so the ledger is
 * cancelled explicitly instead of leaving an entry pointing at nothing.
 */
export async function deleteProjectWithItems(
  repo: DeleteProjectOps,
  projectId: string,
  actor?: string,
): Promise<void> {
  const snapshot = await repo.getSnapshot();
  if (!snapshot.projects.some((project) => project.id === projectId)) {
    throw new RuleError("NOT_FOUND", "That project was not found.", 404);
  }
  const billed = snapshot.billingItems.some(
    (item) => item.projectId === projectId && !item.deletedAt && item.invoiceId,
  );
  if (billed) {
    await restoreProjectsToBilling(repo, { projectIds: [projectId], actor });
  }

  const latest = await repo.getSnapshot();
  for (const item of latest.billingItems) {
    if (item.projectId !== projectId || item.deletedAt) continue;
    await repo.deleteBillingItem(item.id, actor);
  }
  await repo.deleteProject(projectId, actor);
}
