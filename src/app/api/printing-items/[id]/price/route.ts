import { handleAs, num, readJson, str } from "@/lib/api";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await readJson(request);
  return handleAs((repo) =>
    repo.reviewPrintPrice(id, {
      unitPrice: num(body.unitPrice) ?? 0,
      amount: num(body.amount) ?? 0,
      confirm: body.confirm === true,
      priceSource: str(body.priceSource),
      priceReason: str(body.priceReason),
    }),
  );
}
