import { readJson } from "@/lib/api";
import { handleV5, invoiceInputFrom } from "@/lib/billing-v5/api";

export const dynamic = "force-dynamic";

/**
 * Edit an issued invoice. Its number and identity never change and the
 * previous version is kept as a revision. There is no DELETE: invoices are
 * cancelled, never removed.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJson(request);
  return handleV5(["invoice:write", "payment:write"], (store, user) => store.editInvoice(id, invoiceInputFrom(body, user.name)));
}
