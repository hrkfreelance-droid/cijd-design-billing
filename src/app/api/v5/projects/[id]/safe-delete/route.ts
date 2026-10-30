import { handleV5 } from "@/lib/billing-v5/api";

export const dynamic = "force-dynamic";

/** Guarded, atomic soft-delete restricted to never-invoiced projects. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleV5(["invoice:write"], (store, user) => store.deleteUninvoicedV5Project(id, user.name));
}
