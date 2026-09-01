import { RuleError, type Repository } from "@/lib/data/repository";
import { isProductionComplete } from "@/lib/derive";
import type { BillingStatus, ReceiptStatus, Snapshot } from "@/lib/types";
import { can, type Permission, type Role } from "./roles";
import type { SessionUser } from "./session";

/**
 * Every request goes through here, so a role can only ever reach the data and
 * the operations it is entitled to — regardless of which URL was typed or which
 * endpoint was called directly.
 */
export class GuardedRepository {
  constructor(
    private readonly repo: Repository,
    private readonly user: SessionUser,
  ) {}

  get role(): Role {
    return this.user.role;
  }

  private assert(permission: Permission) {
    if (!can(this.user.role, permission)) {
      throw new RuleError("FORBIDDEN", "You do not have access to this.", 403);
    }
  }

  /** Trims the snapshot down to the slice this role is allowed to see. */
  async getSnapshot(): Promise<Snapshot> {
    const snapshot = await this.repo.getSnapshot();
    const production = can(this.user.role, "production:read");
    const progress = can(this.user.role, "progress:read");
    const billing = can(this.user.role, "billing:read");
    const payment = can(this.user.role, "payment:read");
    const printing = can(this.user.role, "printing:read");

    if (printing && this.user.role === "PRINTING") {
      snapshot.billingItems = snapshot.billingItems.filter((item) => item.type === "PRINT");
      const projectIds = new Set(snapshot.billingItems.map((item) => item.projectId));
      snapshot.projects = snapshot.projects.filter((project) => projectIds.has(project.id));
      snapshot.invoices = [];
      snapshot.invoiceItems = [];
      snapshot.users = [];
    }

    if (!production && !progress) {
      // Unfinished work never leaves the designer side.
      const delivered = snapshot.billingItems.filter(
        isProductionComplete,
      );
      const projectIds = new Set(delivered.map((item) => item.projectId));
      snapshot.billingItems = delivered;
      snapshot.projects = snapshot.projects.filter((project) =>
        projectIds.has(project.id),
      );
    }
    if (!billing && !payment) {
      snapshot.invoices = [];
      snapshot.invoiceItems = [];
    }
    // Keep the public scope shape backward-compatible; the dedicated printing
    // slice is enforced by the filtered rows above and by the route permission.
    snapshot.scope = { production, billing, payment };
    return snapshot;
  }

  createClient(input: { name: string; actor?: string }) {
    this.assert("client:write");
    return this.repo.createClient({ ...input, actor: this.actor(input.actor) });
  }

  updateClient(id: string, patch: { name?: string; active?: boolean; actor?: string }) {
    this.assert("client:write");
    return this.repo.updateClient(id, { ...patch, actor: this.actor(patch.actor) });
  }

  createProject(input: Parameters<Repository["createProject"]>[0]) {
    this.assert("production:write");
    return this.repo.createProject({ ...input, createdBy: this.actor(input.createdBy) });
  }

  updateProject(id: string, patch: Parameters<Repository["updateProject"]>[1]) {
    this.assert("production:write");
    return this.repo.updateProject(id, { ...patch, actor: this.actor(patch.actor) });
  }

  createBillingItem(input: Parameters<Repository["createBillingItem"]>[0]) {
    this.assert("production:write");
    return this.repo.createBillingItem({ ...input, actor: this.actor(input.actor) });
  }

  updateBillingItem(id: string, patch: Parameters<Repository["updateBillingItem"]>[1]) {
    this.assert("production:write");
    return this.repo.updateBillingItem(id, { ...patch, actor: this.actor(patch.actor) });
  }

  updatePrintSpec(id: string, patch: Parameters<Repository["updatePrintSpec"]>[1]) {
    this.assert("print:write");
    return this.repo.updatePrintSpec(id, { ...patch, actor: this.actor(patch.actor) });
  }

  reviewPrintPrice(id: string, input: Parameters<Repository["reviewPrintPrice"]>[1]) {
    this.assert("print:write");
    return this.repo.reviewPrintPrice(id, { ...input, actor: this.actor(input.actor) });
  }

  setBillingStatus(id: string, status: BillingStatus, actor?: string) {
    this.assert("production:write");
    return this.repo.setBillingStatus(id, status, this.actor(actor));
  }

  setItemDelivery(id: string, delivered: boolean, actor?: string) {
    this.assert("delivery:write");
    return this.repo.setItemDelivery(id, delivered, this.actor(actor));
  }

  setItemCompletion(id: string, completed: boolean, actor?: string) {
    this.assert("delivery:write");
    if (this.user.role === "PRINTING") {
      throw new RuleError("FORBIDDEN", "Printing items use delivery, not creative completion.", 403);
    }
    return this.repo.setItemCompletion(id, completed, this.actor(actor));
  }

  setProjectDelivery(projectId: string, delivered: boolean, actor?: string) {
    this.assert("delivery:write");
    if (this.user.role === "PRINTING") {
      throw new RuleError("FORBIDDEN", "Printing work is handled one item at a time.", 403);
    }
    return this.repo.setProjectDelivery(projectId, delivered, this.actor(actor));
  }

  deleteBillingItem(id: string, actor?: string) {
    this.assert("production:write");
    return this.repo.deleteBillingItem(id, this.actor(actor));
  }

  createInvoice(input: Parameters<Repository["createInvoice"]>[0]) {
    this.assert("invoice:write");
    return this.repo.createInvoice({ ...input, actor: this.actor(input.actor) });
  }

  voidInvoice(id: string, actor?: string) {
    this.assert("invoice:write");
    return this.repo.voidInvoice(id, this.actor(actor));
  }

  confirmPayment(id: string, input: Parameters<Repository["confirmPayment"]>[1]) {
    this.assert("payment:write");
    return this.repo.confirmPayment(id, { ...input, actor: this.actor(input.actor) });
  }

  revertPayment(id: string, actor?: string) {
    this.assert("payment:write");
    return this.repo.revertPayment(id, this.actor(actor));
  }

  setReceiptStatus(id: string, status: ReceiptStatus, actor?: string) {
    this.assert("payment:write");
    return this.repo.setReceiptStatus(id, status, this.actor(actor));
  }

  async listNotifications() {
    this.assert("notification:manage");
    return this.repo.listNotifications();
  }

  async getNotification(id: string) {
    this.assert("notification:manage");
    return this.repo.getNotification(id);
  }

  /** Actions always record the signed-in person, not whatever was posted. */
  private actor(supplied?: string): string {
    return supplied && this.user.role === "ADMIN" ? supplied : this.user.name;
  }
}
