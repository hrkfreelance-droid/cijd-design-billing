import { handleAs, readJson, str } from "@/lib/api";

/** Billing V2: record the selected projects as billed and move them to Archive. */
export async function POST(request: Request) {
  const body = await readJson(request);
  const projectIds = Array.isArray(body.projectIds)
    ? body.projectIds.map((value) => str(value)).filter((value): value is string => !!value)
    : [];
  return handleAs((repo) =>
    repo.markProjectsBilled({ projectIds, billedOn: str(body.billedOn) }),
  );
}
