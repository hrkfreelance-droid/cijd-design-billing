import type { V3Rows } from "../../src/lib/billing-v5/v3-import.ts";

export const T = "2026-09-01T00:00:00Z";

/** Raw V3 rows, as Supabase returns them (numeric columns come back as strings). */
export function fixture(): V3Rows {
  const item = (id: string, project: string, extra: Record<string, unknown>) => ({
    id, project_id: project, description: id, type: "DESIGN", service_type: "DESIGN", quantity: "1", unit_price: "0",
    amount: null, custom_amount: false, production_status: "DELIVERED", billing_status: "READY_TO_INVOICE",
    delivered_at: T, delivered_by: "Hiroki", invoice_id: null, note: null, created_at: T, created_by: "Hiroki",
    updated_at: T, updated_by: "Hiroki", deleted_at: null, ...extra,
  });
  const project = (id: string, extra: Record<string, unknown>) => ({
    id, client_id: "c1", name: id, date: "2026-09-01", note: null, created_at: T, created_by: "Hiroki",
    updated_at: T, updated_by: "Hiroki", deleted_at: null, billing_readiness: "AUTO", deposit_amount: null, ...extra,
  });
  return {
    clients: [
      { id: "c1", name: "Ringer Hut", active: true, created_at: T },
      { id: "c2", name: "Old Client", active: false, created_at: T },
    ],
    projects: [
      project("p-ready", { note: "Deliver Friday\nKhmer name on invoice", billing_readiness: "READY", deposit_amount: "500.00" }),
      project("p-progress", { billing_readiness: "IN_PROGRESS" }),
      project("p-billed", {}),
      project("p-deleted", { deleted_at: T, note: "gone" }),
    ],
    billing_items: [
      // A manual total that is not unit × qty to the cent: must stay $305.00.
      item("l-manual", "p-ready", { type: "PRINT", service_type: "PRINTING", quantity: "170", unit_price: "1.79", amount: "305.00", billing_price_manual: true, print_cost: "200.00", price_review_status: "CONFIRMED" }),
      // Priced under an older rule ($40 cost → $80): never re-priced.
      item("l-oldrule", "p-ready", { type: "PRINT", service_type: "PRINTING", quantity: "180", unit_price: "0.44", amount: "80.00", billing_price_manual: false, print_cost: "40.00", markup_override: "35.00", price_review_status: "CONFIRMED", note: "rush" }),
      item("l-design", "p-ready", { quantity: "2", unit_price: "305.00", amount: "610.00", custom_amount: true }),
      item("l-pending", "p-progress", { billing_status: "NOT_READY", production_status: "IN_PROGRESS" }),
      item("l-billed", "p-billed", { amount: "150.00", custom_amount: true, billing_status: "PAID", invoice_id: "i1" }),
      item("l-deleted", "p-deleted", { amount: "99.00", deleted_at: T }),
    ],
    invoices: [{ id: "i1", client_id: "c1", invoice_number: "CIJD-20260901-ABCD1234", invoice_date: "2026-09-01", amount: "150.00", status: "PAID", receipt_status: "RECEIVED", exchange_rate: "4100", created_at: T, created_by: "Billing", updated_at: T, updated_by: "Billing" }],
    invoice_items: [{ invoice_id: "i1", billing_item_id: "l-billed" }],
    payments: [{ id: "pay1", invoice_id: "i1", amount: "150.00", paid_at: "2026-09-02", created_at: T, created_by: "Accounting" }],
    users: [{ id: "u1", name: "Hiroki", role: "DESIGNER" }],
    service_types: [
      { id: "st_design", key: "DESIGN", name: "Design", active: true, created_at: T },
      { id: "st_printing", key: "PRINTING", name: "Printing", active: true, created_at: T },
    ],
    exchange_rates: [{ id: "r1", currency_pair: "USD/KHR", rate: "4100", source: "NBC", effective_date: "2026-09-01", fetched_at: T }],
  };
}

