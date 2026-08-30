import { handleAs, num, readJson, str } from "@/lib/api";
import type { BillingStatus, ItemType } from "@/lib/types";

export async function POST(request: Request) {
  const body = await readJson(request);
  return handleAs((repo) =>
    repo.createBillingItem({
      projectId: str(body.projectId) ?? "",
      description: str(body.description) ?? "",
      type: str(body.type) as ItemType | undefined,
      quantity: num(body.quantity),
      unitPrice: num(body.unitPrice),
      amount: num(body.amount),
      billingStatus: str(body.billingStatus) as BillingStatus | undefined,
      note: str(body.note),
    }),
  );
}
