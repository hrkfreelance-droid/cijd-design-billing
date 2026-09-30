-- CIJD Billing V5 — Customer company documents (additive).
-- Internal only (Patent Tax, VAT certificate, registration, licence, other):
-- never on a Tax Invoice. The files live in V5's own R2 bucket
-- (binding V5_DOCS); this table holds only their metadata. Nothing existing
-- is altered. Rows are never deleted: a replaced document keeps its row,
-- marked replaced, and the new row points back to it.

CREATE TABLE IF NOT EXISTS v5_customer_documents (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  document_type TEXT NOT NULL,
  original_file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  memo TEXT,
  uploaded_at TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  replaces_id TEXT,
  replaced_at TEXT,
  replaced_by TEXT
);

CREATE INDEX IF NOT EXISTS v5_customer_documents_customer ON v5_customer_documents (customer_id, uploaded_at);

CREATE TRIGGER IF NOT EXISTS v5_customer_documents_no_delete
BEFORE DELETE ON v5_customer_documents
BEGIN
  SELECT RAISE(ABORT, 'customer documents are kept');
END;

-- Only the replacement marker may change after upload.
CREATE TRIGGER IF NOT EXISTS v5_customer_documents_fixed
BEFORE UPDATE OF id, customer_id, document_type, original_file_name, content_type, size_bytes, storage_key, uploaded_at, uploaded_by, replaces_id ON v5_customer_documents
BEGIN
  SELECT RAISE(ABORT, 'customer documents are immutable');
END;
