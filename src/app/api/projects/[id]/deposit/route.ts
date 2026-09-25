import { handleAs, num, readJson } from "@/lib/api";
import { RuleError } from "@/lib/data/repository";

/** Narrow write: the money already received for a project, and nothing else. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await readJson(request);
  return handleAs(async (repo) => {
    const amount = body.amount === null ? null : num(body.amount);
    if (amount === undefined) throw new RuleError("INVALID", "Deposit must be a number.", 400);
    return repo.setProjectDeposit(id, amount);
  });
}
