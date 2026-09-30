import { handleV5 } from "@/lib/billing-v5/api";
import { listCustomerDocuments, uploadCustomerDocument } from "@/lib/billing-v5/documents";
import { v5DocumentStorage } from "@/lib/billing-v5/repository";
import { RuleError } from "@/lib/data/repository";

export const dynamic = "force-dynamic";

/** A customer's company documents (metadata only; files via /api/v5/customer-documents/:id). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleV5(["invoice:write", "payment:write"], async () => listCustomerDocuments(v5DocumentStorage().db, id));
}

/**
 * Upload (multipart: file, documentType, memo?, replacesId?). Separate from
 * saving the Customer Master: a failed upload never changes the customer.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleV5(["invoice:write", "payment:write"], async (store, user) => {
    const snapshot = await store.getSnapshot();
    if (!snapshot.clients.some((client) => client.id === id)) throw new RuleError("NOT_FOUND", "Customer was not found.", 404);
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new RuleError("INVALID", "Send the file as a form upload.", 400);
    }
    const file = form.get("file");
    if (!file || typeof file === "string") throw new RuleError("INVALID", "Choose a file.", 400);
    const text = (key: string) => {
      const value = form.get(key);
      return typeof value === "string" ? value : null;
    };
    const { db, bucket } = v5DocumentStorage();
    return uploadCustomerDocument(db, bucket, {
      customerId: id,
      documentType: text("documentType") ?? "",
      fileName: file.name,
      declaredType: file.type,
      bytes: await file.arrayBuffer(),
      memo: text("memo"),
      replacesId: text("replacesId"),
      actor: user.name,
    });
  });
}
