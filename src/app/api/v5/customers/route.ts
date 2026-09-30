import { readJson } from "@/lib/api";
import { handleV5 } from "@/lib/billing-v5/api";
import type { CustomerInput } from "@/lib/billing-v5/invoicing";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await readJson(request);
  const { id: _ignored, ...fields } = body;
  void _ignored;
  return handleV5(["invoice:write", "payment:write"], (store, user) => store.saveCustomer({ ...(fields as Partial<CustomerInput>), actor: user.name }));
}
