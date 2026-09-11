import { handleAs, readJson, str } from "@/lib/api";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await readJson(request);
  return handleAs((repo) =>
    repo.setProjectBillingReadiness(
      id,
      str(body.readiness) as "READY" | "IN_PROGRESS" | "AUTO",
    ),
  );
}
