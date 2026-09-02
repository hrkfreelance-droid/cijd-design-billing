import type { BillingItem, Database, ItemType, Project } from "@/lib/types";
import { buildSeed } from "./seed";

/**
 * Browser-only preview fixture. These are the current operational examples
 * supplied for UI review; this function is never used by the server JSON store
 * or the Supabase repository.
 */
export function buildDemoSeed(): Database {
  const db = buildSeed();
  // The operational Correction $15 belongs to Production only. Preview keeps
  // the other RH Kids prices as UI fixtures without copying that base record.
  db.billingItems = db.billingItems.filter((item) => item.id !== "bi_rh_kids_correction");
  // Hiroki mirrors the real Admin account in preview. Supporting operators keep
  // narrow workspaces so role boundaries are still visible during UI review.
  db.users = [
    { id: "u_hiroki", name: "Hiroki", role: "ADMIN" },
    { id: "u_printing", name: "Printing Staff", role: "PRINTING" },
    { id: "u_billing", name: "Billing Staff", role: "BILLING" },
    { id: "u_accounting", name: "Accounting", role: "ACCOUNTING" },
  ];
  const now = new Date().toISOString();
  const date = "2026-08-31";

  const projects: Project[] = [
    project("pj_demo_spicy_egg", "RH Spicy Egg Voucher", now, date),
    project("pj_demo_free_karaage", "RH FREE Vouchers — Karaage", now, date),
    project("pj_demo_chicken_katsu", "RH Chicken Katsu", now, date),
    project("pj_demo_grand_menu", "RH Grand Menu", now, date),
  ];
  db.projects.push(...projects);

  db.billingItems.push(
    creative("bi_demo_spicy_design", projects[0].id, "Design", "DESIGN", 25, now),
    print("bi_demo_spicy_print", projects[0].id, "Print ×100", 100, 0.15, 15, now, {
      source: "Historical",
      reason: "Previous same-condition Print ×100 = $15",
    }),
    creative("bi_demo_karaage_revision", projects[1].id, "Revision", "DESIGN", 5, now),
    print("bi_demo_karaage_print", projects[1].id, "Print ×900", 900, 0.06, 54, now, {
      source: "Historical",
      reason: "FREE Voucher historical rate: $0.06 / pc",
    }),
    creative("bi_demo_katsu_design", projects[2].id, "Design & Map", "DESIGN", 35, now),
    printPending("bi_demo_katsu_print", projects[2].id, "Print ×2000", 2000, now),
    creative("bi_demo_kids_revision", "pj_rh_kids_promotion", "Revision", "DESIGN", 15, now),
    creative("bi_demo_kids_istand", "pj_rh_kids_promotion", "iStand", "OTHER", 25, now),
    creative(
      "bi_demo_grand_design",
      projects[3].id,
      "Design",
      "DESIGN",
      125,
      now,
      "NEEDS_REVIEW",
      "Suggested price requires review.",
    ),
  );

  return db;
}

/** Remove a legacy copy if this browser opened the preview before the fixture was corrected. */
export function removePreviewOnlyRecords(db: Database): Database {
  const removed = new Set(
    db.billingItems
      .filter((item) => item.id === "bi_rh_kids_correction")
      .map((item) => item.id),
  );
  if (!removed.size) return db;
  db.billingItems = db.billingItems.filter((item) => !removed.has(item.id));
  const invoiceIds = new Set(
    db.invoiceItems
      .filter((link) => removed.has(link.billingItemId))
      .map((link) => link.invoiceId),
  );
  db.invoiceItems = db.invoiceItems.filter((link) => !removed.has(link.billingItemId));
  db.invoices = db.invoices.filter((invoice) => !invoiceIds.has(invoice.id));
  db.payments = db.payments.filter((payment) => !invoiceIds.has(payment.invoiceId));
  return db;
}

function project(id: string, name: string, now: string, date: string): Project {
  return {
    id,
    clientId: "cl_ringer_hut",
    name,
    date,
    createdAt: now,
    createdBy: "Hiroki",
    updatedAt: now,
    updatedBy: "Hiroki",
    deletedAt: null,
  };
}

function creative(
  id: string,
  projectId: string,
  description: string,
  type: ItemType,
  amount: number,
  now: string,
  billingStatus: "NOT_READY" | "NEEDS_REVIEW" = "NOT_READY",
  note?: string,
): BillingItem {
  return {
    id,
    projectId,
    description,
    type,
    quantity: 1,
    unitPrice: amount,
    amount,
    customAmount: false,
    productionStatus: "IN_PROGRESS",
    billingStatus,
    deliveredAt: null,
    deliveredBy: null,
    invoiceId: null,
    priceReviewStatus: "NOT_REQUIRED",
    suggestedUnitPrice: null,
    suggestedAmount: null,
    priceSource: null,
    priceReason: null,
    priceConfirmedBy: null,
    priceConfirmedAt: null,
    note,
    createdAt: now,
    createdBy: "Hiroki",
    updatedAt: now,
    updatedBy: "Hiroki",
    deletedAt: null,
  };
}

function print(
  id: string,
  projectId: string,
  description: string,
  quantity: number,
  unitPrice: number,
  amount: number,
  now: string,
  review: { source: string; reason: string },
): BillingItem {
  return {
    ...creative(id, projectId, description, "PRINT", amount, now),
    quantity,
    unitPrice,
    priceReviewStatus: "REVIEW_REQUIRED",
    suggestedUnitPrice: unitPrice,
    suggestedAmount: amount,
    priceSource: review.source,
    priceReason: review.reason,
  };
}

function printPending(
  id: string,
  projectId: string,
  description: string,
  quantity: number,
  now: string,
): BillingItem {
  return {
    ...creative(id, projectId, description, "PRINT", 0, now),
    quantity,
    unitPrice: 0,
    amount: 0,
    priceReviewStatus: "REVIEW_REQUIRED",
    note: "Size and specification required.",
  };
}
