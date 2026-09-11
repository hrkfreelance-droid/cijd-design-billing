import { handleAs, readJson, str } from "@/lib/api";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await readJson(request);
  return handleAs((repo) =>
    repo.updateClient(id, {
      name: str(body.name),
      active: typeof body.active === "boolean" ? body.active : undefined,
    }),
  );
}
