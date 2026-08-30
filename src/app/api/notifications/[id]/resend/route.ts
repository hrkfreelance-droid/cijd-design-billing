import { handleAs } from "@/lib/api";
import { getRepository } from "@/lib/data";
import { resendNotification } from "@/lib/telegram/notify";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleAs(async (repo) => {
    // Permission check first, then the send itself.
    await repo.getNotification(id);
    return resendNotification(await getRepository(), id);
  });
}
