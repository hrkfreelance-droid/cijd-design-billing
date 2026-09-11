import { handleAs, readJson, str } from "@/lib/api";

export async function POST(request: Request) {
  const body = await readJson(request);
  return handleAs((repo) => repo.createClient({ name: str(body.name) ?? "" }));
}
