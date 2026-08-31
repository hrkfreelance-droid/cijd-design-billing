import { handleAs, num, readJson, str } from "@/lib/api";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await readJson(request);
  return handleAs((repo) =>
    repo.updatePrintSpec(id, {
      description: str(body.description),
      printSize: str(body.printSize),
      quantity: num(body.quantity),
      note: str(body.note),
    }),
  );
}
