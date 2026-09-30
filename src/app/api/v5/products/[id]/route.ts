import { readJson } from "@/lib/api";
import { handleV5 } from "@/lib/billing-v5/api";
import type { ProductInput } from "@/lib/billing-v5/invoicing";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJson(request);
  return handleV5(["invoice:write", "payment:write"], (store, user) => store.saveProduct({ ...(body as Partial<ProductInput>), id, actor: user.name }));
}
