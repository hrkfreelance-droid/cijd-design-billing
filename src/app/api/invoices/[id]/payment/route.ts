import { handleAs, readJson, str } from "@/lib/api";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await readJson(request);
  return handleAs((repo) =>
    repo.confirmPayment(id, {
      paymentDate: str(body.paymentDate) ?? "",
      slip: str(body.slip),
    }),
  );
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleAs((repo) => repo.revertPayment(id));
}
