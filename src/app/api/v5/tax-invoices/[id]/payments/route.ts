import { num, readJson, str } from "@/lib/api";
import { handleV5 } from "@/lib/billing-v5/api";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJson(request);
  return handleV5(["payment:write"], (store, user) =>
    store.addInvoicePayment({ invoiceId: id, amount: num(body.amount) ?? Number.NaN, paidOn: str(body.paidOn), note: str(body.note), actor: user.name }),
  );
}
