import { handleAs, num, readJson } from "@/lib/api";

/**
 * Narrow Billing-only operation: change the selling price, not the work.
 * With `unitPrice`, the final unit price is stored alongside the total.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await readJson(request);
  const unitPrice = num(body.unitPrice);
  return handleAs((repo) =>
    unitPrice === undefined
      ? repo.overrideBillingPrice(id, num(body.amount) ?? 0)
      : repo.overrideBillingUnitPrice(id, unitPrice, num(body.amount) ?? 0),
  );
}
