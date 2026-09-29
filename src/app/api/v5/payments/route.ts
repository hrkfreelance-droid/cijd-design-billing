import { num, readJson, str } from "@/lib/api";
import { handleV5 } from "@/lib/billing-v5/api";
import type { ProjectPaymentKind } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await readJson(request);
  return handleV5(["payment:write"], (store, user) =>
    store.addProjectPayment({
      projectId: str(body.projectId) ?? "",
      kind: (str(body.kind) ?? "PARTIAL") as ProjectPaymentKind,
      amount: num(body.amount) ?? Number.NaN,
      paidOn: str(body.paidOn),
      note: str(body.note),
      actor: user.name,
    }),
  );
}
