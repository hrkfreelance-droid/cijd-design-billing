import { readJson, str } from "@/lib/api";
import { handleV5 } from "@/lib/billing-v5/api";

export const dynamic = "force-dynamic";

/** Internal No invoice: closes remaining billing without any Tax Invoice. */
export async function POST(request: Request) {
  const body = await readJson(request);
  const ids = Array.isArray(body.billingItemIds) && body.billingItemIds.every((id) => typeof id === "string")
    ? body.billingItemIds as string[] : [];
  return handleV5(["invoice:write", "payment:write"], (store, user) =>
    store.issueNoInvoice({ clientId: str(body.clientId) ?? "", billingItemIds: ids, actor: user.name }));
}
