import assert from "node:assert/strict";
import { test } from "node:test";

import { documentHeaders, listCustomerDocuments, uploadCustomerDocument, type R2BucketLike } from "../../src/lib/billing-v5/documents.ts";
import { RuleError } from "../../src/lib/data/repository.ts";
import { sqliteD1 } from "./d1-sqlite.ts";

function memoryBucket() {
  const objects = new Map<string, { bytes: Uint8Array; type?: string }>();
  const bucket: R2BucketLike = {
    async put(key, value, options) {
      objects.set(key, { bytes: new Uint8Array(value instanceof Uint8Array ? value : new Uint8Array(value)), type: options?.httpMetadata?.contentType });
    },
    async get(key) {
      const object = objects.get(key);
      if (!object) return null;
      return { body: null, arrayBuffer: async () => object.bytes.slice().buffer };
    },
    async delete(key) {
      objects.delete(key);
    },
  };
  return { bucket, objects };
}

const pdf = new TextEncoder().encode("%PDF-1.4 TEST patent tax").buffer as ArrayBuffer;
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).buffer as ArrayBuffer;
const rejects = (promise: Promise<unknown>, code: string) => assert.rejects(promise, (error: unknown) => error instanceof RuleError && error.code === code);

test("company documents: upload, list, view headers, replace (history kept), validation; nothing public", async () => {
  const d1 = sqliteD1();
  const { bucket, objects } = memoryBucket();
  const first = await uploadCustomerDocument(d1, bucket, { customerId: "c1", documentType: "PATENT_TAX", fileName: "patent tax 2026.pdf", declaredType: "application/pdf", bytes: pdf, memo: "TEST", actor: "TEST" });
  assert.deepEqual([first.documentType, first.originalFileName, first.contentType, first.sizeBytes, first.memo, first.replacedAt], ["PATENT_TAX", "patent tax 2026.pdf", "application/pdf", pdf.byteLength, "TEST", null]);
  assert.equal(first.storageKey, `customers/c1/${first.id}`);
  assert.deepEqual([...objects.keys()], [first.storageKey]);
  assert.equal(objects.get(first.storageKey)!.type, "application/pdf");

  // Another customer's documents are separate.
  await uploadCustomerDocument(d1, bucket, { customerId: "c2", documentType: "OTHER", fileName: "x.png", bytes: png, actor: "TEST" });
  assert.equal((await listCustomerDocuments(d1, "c1")).length, 1);

  // Replace: a new row pointing back; the old one is kept, marked replaced.
  const second = await uploadCustomerDocument(d1, bucket, { customerId: "c1", documentType: "PATENT_TAX", fileName: "patent-2026-v2.jpg", declaredType: "image/jpeg", bytes: png, replacesId: first.id, actor: "TEST" });
  const list = await listCustomerDocuments(d1, "c1");
  assert.deepEqual(list.map((d) => [d.id, d.replacesId, !!d.replacedAt]).sort(), [[first.id, null, true], [second.id, first.id, false]].sort());
  assert.equal(second.contentType, "image/jpeg");
  await rejects(uploadCustomerDocument(d1, bucket, { customerId: "c1", documentType: "PATENT_TAX", fileName: "again.pdf", bytes: pdf, replacesId: first.id, actor: "TEST" }), "ALREADY_REPLACED");
  await rejects(uploadCustomerDocument(d1, bucket, { customerId: "c2", documentType: "PATENT_TAX", fileName: "again.pdf", bytes: pdf, replacesId: second.id, actor: "TEST" }), "NOT_FOUND");

  // Validation: type, format, empty, size.
  await rejects(uploadCustomerDocument(d1, bucket, { customerId: "c1", documentType: "INVOICE", fileName: "a.pdf", bytes: pdf, actor: "TEST" }), "INVALID");
  await rejects(uploadCustomerDocument(d1, bucket, { customerId: "c1", documentType: "OTHER", fileName: "run.exe", declaredType: "application/octet-stream", bytes: pdf, actor: "TEST" }), "INVALID");
  await rejects(uploadCustomerDocument(d1, bucket, { customerId: "c1", documentType: "OTHER", fileName: "a.pdf", bytes: new ArrayBuffer(0), actor: "TEST" }), "INVALID");
  await rejects(uploadCustomerDocument(d1, bucket, { customerId: "c1", documentType: "OTHER", fileName: "a.pdf", bytes: new ArrayBuffer(20 * 1024 * 1024 + 1), actor: "TEST" }), "INVALID");

  // Metadata rows cannot be deleted or rewritten.
  assert.throws(() => d1.raw.prepare("DELETE FROM v5_customer_documents").run(), /kept/);
  assert.throws(() => d1.raw.prepare("UPDATE v5_customer_documents SET storage_key = 'x'").run(), /immutable/);

  // View inline / download as attachment, never cached by shared caches; file names are safe.
  const view = documentHeaders({ ...first, originalFileName: "ប៉ាតង់ 2026.pdf" }, false);
  assert.match(view.get("content-disposition")!, /^inline; filename="_+ 2026\.pdf"; filename\*=UTF-8''/);
  assert.equal(documentHeaders(first, true).get("content-disposition")!.startsWith("attachment;"), true);
  assert.equal(view.get("cache-control"), "private, no-store");
  assert.equal(view.get("x-content-type-options"), "nosniff");
});

test("company documents: a failed metadata write leaves no stored file behind", async () => {
  const d1 = sqliteD1();
  const { bucket, objects } = memoryBucket();
  const broken = { ...d1, batch: async () => { throw new Error("D1 down"); } };
  await assert.rejects(uploadCustomerDocument(broken, bucket, { customerId: "c1", documentType: "VAT_CERTIFICATE", fileName: "vat.pdf", bytes: pdf, actor: "TEST" }), /D1 down/);
  assert.equal(objects.size, 0);
  assert.equal((await listCustomerDocuments(d1, "c1")).length, 0);
});
