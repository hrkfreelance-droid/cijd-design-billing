import { handleV5 } from "@/lib/billing-v5/api";

export const dynamic = "force-dynamic";

/** Restore linked billing without erasing the issue/audit record. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleV5(["invoice:write", "payment:write"], (store, user) => store.cancelNoInvoice(id, user.name));
}
