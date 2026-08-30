import { handleAs } from "@/lib/api";
import { announceDelivery } from "@/lib/delivery";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleAs(async (repo) => {
    const item = await repo.setItemDelivery(id, true);
    await announceDelivery(item.projectId, [item]);
    return item;
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleAs((repo) => repo.setItemDelivery(id, false));
}
