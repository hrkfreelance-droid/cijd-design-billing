import { handleAs, readJson, str } from "@/lib/api";

export async function POST(request: Request) {
  const body = await readJson(request);
  return handleAs((repo) =>
    repo.createProject({
      clientId: str(body.clientId) ?? "",
      name: str(body.name) ?? "",
      createdBy: str(body.createdBy),
      date: str(body.date),
      note: str(body.note),
    }),
  );
}
