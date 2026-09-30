import { readJson } from "@/lib/api";
import { handleV5, invoiceInputFrom } from "@/lib/billing-v5/api";

export const dynamic = "force-dynamic";

/** Issue a Tax Invoice: one customer, one or more billing lines and/or free lines. */
export async function POST(request: Request) {
  const body = await readJson(request);
  return handleV5(["invoice:write", "payment:write"], (store, user) => store.issueInvoice(invoiceInputFrom(body, user.name)));
}
