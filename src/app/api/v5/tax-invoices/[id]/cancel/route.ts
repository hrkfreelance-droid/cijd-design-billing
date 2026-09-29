import { readJson, str } from "@/lib/api";
import { handleV5 } from "@/lib/billing-v5/api";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJson(request);
  return handleV5(["invoice:write", "payment:write"], (store, user) =>
    store.cancelTaxInvoice(id, str(body.reason) ?? "", user.name),
  );
}
