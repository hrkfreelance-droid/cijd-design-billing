import { handleAs } from "@/lib/api";

/** Marks the whole project delivered and hands it to billing. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleAs((repo) => repo.setProjectDelivery(id, true));
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleAs((repo) => repo.setProjectDelivery(id, false));
}
