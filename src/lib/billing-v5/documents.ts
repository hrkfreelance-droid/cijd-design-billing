/**
 * Customer company documents (Patent Tax, VAT certificate, registration,
 * business licence, other) — internal records, never part of a Tax Invoice.
 *
 * Files go to V5's own R2 bucket (binding V5_DOCS); metadata to the
 * insert-only D1 table v5_customer_documents (migration 0003). This is kept
 * apart from the Customer Master state on purpose: an upload that fails never
 * touches, blocks or corrupts the customer record, and a customer save never
 * depends on storage. Files are only ever served through V5's API routes.
 */
import { RuleError } from "@/lib/data/repository";
import type { D1DatabaseLike } from "./d1-persistence";

export const DOCUMENT_TYPES = ["PATENT_TAX", "VAT_CERTIFICATE", "COMPANY_REGISTRATION", "BUSINESS_LICENSE", "OTHER"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** PDF and the common image formats. */
export const DOCUMENT_CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  tif: "image/tiff",
  tiff: "image/tiff",
  bmp: "image/bmp",
};
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

export interface CustomerDocument {
  id: string;
  customerId: string;
  documentType: DocumentType;
  originalFileName: string;
  contentType: string;
  sizeBytes: number;
  storageKey: string;
  memo: string | null;
  uploadedAt: string;
  uploadedBy: string;
  replacesId: string | null;
  replacedAt: string | null;
  replacedBy: string | null;
}

/** The part of R2 this uses (so tests can pass an in-memory bucket). */
export interface R2BucketLike {
  put(key: string, value: ArrayBuffer | Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream | null; arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(key: string): Promise<void>;
}

interface Row {
  id: string;
  customer_id: string;
  document_type: string;
  original_file_name: string;
  content_type: string;
  size_bytes: number;
  storage_key: string;
  memo: string | null;
  uploaded_at: string;
  uploaded_by: string;
  replaces_id: string | null;
  replaced_at: string | null;
  replaced_by: string | null;
}

const fromRow = (row: Row): CustomerDocument => ({
  id: row.id,
  customerId: row.customer_id,
  documentType: row.document_type as DocumentType,
  originalFileName: row.original_file_name,
  contentType: row.content_type,
  sizeBytes: Number(row.size_bytes),
  storageKey: row.storage_key,
  memo: row.memo,
  uploadedAt: row.uploaded_at,
  uploadedBy: row.uploaded_by,
  replacesId: row.replaces_id,
  replacedAt: row.replaced_at,
  replacedBy: row.replaced_by,
});

/** The content type to store: from the extension (the browser's type is only a hint). */
export function documentContentType(fileName: string, declared: string | null | undefined): string | null {
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  const byExtension = DOCUMENT_CONTENT_TYPES[extension];
  if (byExtension) return byExtension;
  const type = (declared ?? "").toLowerCase();
  return Object.values(DOCUMENT_CONTENT_TYPES).includes(type) ? type : null;
}

/** File names are shown and sent back in Content-Disposition: keep them plain. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f"]/g, "").trim().slice(0, 200);
  return cleaned || "document";
}

export async function listCustomerDocuments(db: D1DatabaseLike, customerId: string): Promise<CustomerDocument[]> {
  const result = await db
    .prepare("SELECT * FROM v5_customer_documents WHERE customer_id = ? ORDER BY uploaded_at DESC, id DESC")
    .bind(customerId)
    .all<Row>();
  return (result.results ?? []).map(fromRow);
}

export async function getCustomerDocument(db: D1DatabaseLike, id: string): Promise<CustomerDocument | null> {
  const row = await db.prepare("SELECT * FROM v5_customer_documents WHERE id = ?").bind(id).first<Row>();
  return row ? fromRow(row) : null;
}

export interface UploadInput {
  customerId: string;
  documentType: string;
  fileName: string;
  declaredType?: string | null;
  bytes: ArrayBuffer;
  memo?: string | null;
  /** The document this one replaces (same customer, not already replaced). */
  replacesId?: string | null;
  actor: string;
}

/**
 * Stores the file, then its metadata. If the metadata write fails the stored
 * file is removed again, so a failed upload leaves nothing behind.
 */
export async function uploadCustomerDocument(db: D1DatabaseLike, bucket: R2BucketLike, input: UploadInput, newId: () => string = () => crypto.randomUUID()): Promise<CustomerDocument> {
  if (!DOCUMENT_TYPES.includes(input.documentType as DocumentType)) throw new RuleError("INVALID", "Choose the document type.", 400);
  const fileName = safeFileName(input.fileName);
  const contentType = documentContentType(fileName, input.declaredType);
  if (!contentType) throw new RuleError("INVALID", "Upload a PDF or an image (JPG, PNG, …).", 400);
  const size = input.bytes.byteLength;
  if (size === 0) throw new RuleError("INVALID", "The file is empty.", 400);
  if (size > MAX_DOCUMENT_BYTES) throw new RuleError("INVALID", "The file is larger than 20 MB.", 400);
  let replaced: CustomerDocument | null = null;
  if (input.replacesId) {
    replaced = await getCustomerDocument(db, input.replacesId);
    if (!replaced || replaced.customerId !== input.customerId) throw new RuleError("NOT_FOUND", "The document to replace was not found.", 404);
    if (replaced.replacedAt) throw new RuleError("ALREADY_REPLACED", "That document was already replaced.", 409);
  }

  const id = newId();
  const at = new Date().toISOString();
  const storageKey = `customers/${input.customerId}/${id}`;
  await bucket.put(storageKey, input.bytes, { httpMetadata: { contentType } });
  const memo = input.memo?.trim() || null;
  const statements = [
    db
      .prepare(
        `INSERT INTO v5_customer_documents (id, customer_id, document_type, original_file_name, content_type, size_bytes, storage_key, memo, uploaded_at, uploaded_by, replaces_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, input.customerId, input.documentType, fileName, contentType, size, storageKey, memo, at, input.actor, replaced?.id ?? null),
  ];
  if (replaced) {
    statements.push(
      db.prepare("UPDATE v5_customer_documents SET replaced_at = ?, replaced_by = ? WHERE id = ? AND replaced_at IS NULL").bind(at, input.actor, replaced.id),
    );
  }
  try {
    await db.batch(statements);
  } catch (error) {
    await bucket.delete(storageKey).catch(() => undefined);
    throw error;
  }
  return (await getCustomerDocument(db, id))!;
}

/** Inline for View, attachment for Download; never cached by shared caches. */
export function documentHeaders(document: CustomerDocument, download: boolean): Headers {
  const ascii = document.originalFileName.replace(/[^\x20-\x7e]/g, "_");
  return new Headers({
    "content-type": document.contentType,
    "content-length": String(document.sizeBytes),
    "content-disposition": `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(document.originalFileName)}`,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  });
}
