import { handleAs } from "@/lib/api";
import { announceDelivery } from "@/lib/delivery";

/** Marks the whole project delivered and hands it to billing. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleAs(async (repo) => {
    const items = await repo.setProjectDelivery(id, true);
    // Saved first, announced second: a Telegram failure cannot undo delivery.
    await announceDelivery(id, items);
    return items;
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleAs((repo) => repo.setProjectDelivery(id, false));
}
