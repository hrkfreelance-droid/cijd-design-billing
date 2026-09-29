import { handleV5 } from "@/lib/billing-v5/api";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleV5(["payment:write"], (store, user) => store.voidProjectPayment(id, user.name));
}
