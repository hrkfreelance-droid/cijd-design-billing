import { handleAs, num, readJson } from "@/lib/api";

/** Narrow Billing-only operation: change the selling price, not the work. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await readJson(request);
  return handleAs((repo) => repo.overrideBillingPrice(id, num(body.amount) ?? 0));
}
