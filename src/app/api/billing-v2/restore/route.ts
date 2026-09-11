import { handleAs, readJson, str } from "@/lib/api";

/** Billing V2: bring billed projects back to Billing so they can be edited. */
export async function POST(request: Request) {
  const body = await readJson(request);
  const projectIds = Array.isArray(body.projectIds)
    ? body.projectIds.map((value) => str(value)).filter((value): value is string => !!value)
    : [];
  return handleAs((repo) => repo.restoreProjectsToBilling({ projectIds }));
}
