import { handleAs, readJson, str } from "@/lib/api";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await readJson(request);
  return handleAs((repo) =>
    repo.updateProject(id, {
      name: str(body.name),
      date: str(body.date),
      note: str(body.note),
      clientId: str(body.clientId),
    }),
  );
}
