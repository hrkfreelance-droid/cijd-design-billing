import type { BillingItem, Client, Invoice, Payment, Project } from "../types";

/** Read-only legacy records, kept outside the operational billing collections. */
export interface LegacyProject {
  project: Project;
  client: Pick<Client, "id" | "name">;
  items: BillingItem[];
  invoices: (Invoice & { itemIds: string[] })[];
  payments: Payment[];
}
