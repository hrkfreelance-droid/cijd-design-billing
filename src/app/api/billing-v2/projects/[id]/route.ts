import { handleAs } from "@/lib/api";
import { deleteProjectWithItems } from "@/lib/billing-v2/mark-billed";

/**
 * Removes a project and its work. Billed work is brought back to Billing
 * first, so the ledger entry is cancelled rather than orphaned.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleAs(async (repo) => {
    await deleteProjectWithItems(repo, id);
    return null;
  });
}
