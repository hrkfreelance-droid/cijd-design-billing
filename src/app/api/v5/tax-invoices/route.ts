import { readJson } from "@/lib/api";
import { handleV5, invoiceInputFrom } from "@/lib/billing-v5/api";

import { getV5Persistence } from "@/lib/billing-v5/repository";
import { issueSavedDraft } from "@/lib/billing-v5/drafts";

export const dynamic = "force-dynamic";

/** Issue a Tax Invoice: one customer, one or more billing lines and/or free lines. */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (typeof body.draftId === "string") return handleV5(["invoice:write", "payment:write"], async (_store, user) => {
    const p = getV5Persistence(); const db = (await p.read())!;
    const invoice = issueSavedDraft(db, body.draftId as string, body, user.name, Number(body.draftRevision));
    await p.write(db); return invoice;
  });
  return handleV5(["invoice:write", "payment:write"], (store, user) => store.issueInvoice(invoiceInputFrom(body, user.name)));
}
