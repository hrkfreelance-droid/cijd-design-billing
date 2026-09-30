import { readJson, str } from "@/lib/api";
import { handleV5 } from "@/lib/billing-v5/api";

export const dynamic = "force-dynamic";

/** Payments are voided with a reason, never deleted. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJson(request);
  return handleV5(["payment:write"], (store, user) => store.voidInvoicePayment(id, str(body.reason) ?? "", user.name));
}
