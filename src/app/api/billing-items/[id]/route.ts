import { handleAs, num, readJson, str } from "@/lib/api";
import type { BillingStatus, ItemType } from "@/lib/types";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await readJson(request);
  const billingStatus = str(body.billingStatus) as BillingStatus | undefined;
  return handleAs(async (repo) => {
    if (billingStatus) return repo.setBillingStatus(id, billingStatus);
    return repo.updateBillingItem(id, {
      description: str(body.description),
      type: str(body.type) as ItemType | undefined,
      quantity: num(body.quantity),
      unitPrice: num(body.unitPrice),
      amount: body.amount === null ? null : num(body.amount),
      note: str(body.note),
    });
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleAs((repo) => repo.deleteBillingItem(id));
}
