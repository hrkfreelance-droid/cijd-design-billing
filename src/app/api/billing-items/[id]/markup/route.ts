import { handleAs, num, readJson } from "@/lib/api";
import { RuleError } from "@/lib/data/repository";

/**
 * Narrow write: a line's manual markup percentage, or null to return it to
 * the default band. The final price is not touched.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await readJson(request);
  return handleAs(async (repo) => {
    const markupPercent = body.markupPercent === null ? null : num(body.markupPercent);
    if (markupPercent === undefined) throw new RuleError("INVALID", "Markup must be a number.", 400);
    return repo.setBillingItemMarkup(id, markupPercent);
  });
}
