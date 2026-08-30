import { handleAs, readJson, str } from "@/lib/api";
import type { ReceiptStatus } from "@/lib/types";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await readJson(request);
  const receiptStatus = str(body.receiptStatus) as ReceiptStatus | undefined;
  return handleAs((repo) => repo.setReceiptStatus(id, receiptStatus ?? "PENDING"));
}

/** Cancels the invoice and returns its items to the billing queue. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleAs((repo) => repo.voidInvoice(id));
}
