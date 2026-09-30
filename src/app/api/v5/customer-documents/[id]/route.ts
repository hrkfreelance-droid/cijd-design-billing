import { NextResponse } from "next/server";

import { handleV5 } from "@/lib/billing-v5/api";
import { documentHeaders, getCustomerDocument } from "@/lib/billing-v5/documents";
import { v5DocumentStorage } from "@/lib/billing-v5/repository";
import { RuleError } from "@/lib/data/repository";

export const dynamic = "force-dynamic";

/**
 * View (inline) or download (?download=1) one company document, streamed from
 * V5's private R2 bucket through V5 — there is no public URL for it.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const download = new URL(request.url).searchParams.get("download") === "1";
  let file: Response | null = null;
  const answer = await handleV5(["invoice:write", "payment:write"], async () => {
    const { db, bucket } = v5DocumentStorage();
    const document = await getCustomerDocument(db, id);
    if (!document) throw new RuleError("NOT_FOUND", "Document was not found.", 404);
    const object = await bucket.get(document.storageKey);
    if (!object) throw new RuleError("NOT_FOUND", "The stored file is missing.", 404);
    file = new Response(object.body ?? (await object.arrayBuffer()), { headers: documentHeaders(document, download) });
    return null;
  });
  return file ?? (answer as NextResponse);
}
