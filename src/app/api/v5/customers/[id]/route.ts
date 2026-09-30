import { readJson } from "@/lib/api";
import { handleV5 } from "@/lib/billing-v5/api";
import type { CustomerInput } from "@/lib/billing-v5/invoicing";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJson(request);
  return handleV5(["invoice:write", "payment:write"], (store, user) => store.saveCustomer({ ...(body as Partial<CustomerInput>), id, actor: user.name }));
}
