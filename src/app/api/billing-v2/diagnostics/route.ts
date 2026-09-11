import { NextResponse } from "next/server";

import { currentUser } from "@/lib/auth/session";
import { supabaseServerClient } from "@/lib/supabase/server";

/**
 * Read-only reconciliation view for Billing V2.
 *
 * The ordinary snapshot hides soft-deleted rows and carries no audit trail,
 * which is exactly what is needed to explain where an older Billing figure
 * came from. This returns those rows and the price history behind them, and
 * writes nothing. Admin only, server side; the service key never leaves here.
 */
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json(
      { ok: false, code: "FORBIDDEN", message: "Admin only." },
      { status: 403 },
    );
  }
  const db = await supabaseServerClient();
  if (!db) {
    return NextResponse.json(
      { ok: false, code: "INTERNAL", message: "Database is unavailable." },
      { status: 500 },
    );
  }

  const client = new URL(request.url).searchParams.get("client");

  const [clients, projects, items, invoices, invoiceItems, audits] = await Promise.all([
    db.from("clients").select("*"),
    db.from("projects").select("*"),
    db.from("billing_items").select("*"),
    db.from("invoices").select("*"),
    db.from("invoice_items").select("*"),
    db.from("audit_logs").select("*").order("at", { ascending: true }).limit(4000),
  ]);

  const errors = Object.entries({ clients, projects, items, invoices, invoiceItems, audits })
    .filter(([, result]) => result.error)
    .map(([name, result]) => `${name}: ${result.error?.message}`);

  const clientRows = clients.data ?? [];
  const wanted = client
    ? clientRows.filter((row) => String(row.name).toLowerCase() === client.toLowerCase())
    : clientRows;
  const clientIds = new Set(wanted.map((row) => row.id));
  const projectRows = (projects.data ?? []).filter((row) => clientIds.has(row.client_id));
  const projectIds = new Set(projectRows.map((row) => row.id));
  const itemRows = (items.data ?? []).filter((row) => projectIds.has(row.project_id));
  const itemIds = new Set(itemRows.map((row) => row.id));

  return NextResponse.json({
    ok: true,
    data: {
      errors,
      counts: {
        projects: projectRows.length,
        projectsDeleted: projectRows.filter((row) => row.deleted_at).length,
        items: itemRows.length,
        itemsDeleted: itemRows.filter((row) => row.deleted_at).length,
      },
      clients: wanted,
      projects: projectRows,
      items: itemRows,
      invoices: (invoices.data ?? []).filter((row) => clientIds.has(row.client_id)),
      invoiceItems: (invoiceItems.data ?? []).filter((row) => itemIds.has(row.billing_item_id)),
      audits: (audits.data ?? []).filter(
        (row) => itemIds.has(row.entity_id) || projectIds.has(row.entity_id),
      ),
    },
  });
}
