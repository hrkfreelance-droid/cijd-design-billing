-- CIJD Billing V5 — isolated D1 schema (V5 Worker only).
-- Additive and self-contained: this database is V5's own. It is never
-- pointed at V3 (Supabase) or V4 (cijd-design-billing-v4-preview D1).

CREATE TABLE IF NOT EXISTS v5_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL,
  writer TEXT,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO v5_meta (id, version, writer, updated_at)
VALUES (1, 0, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE TABLE IF NOT EXISTS v5_state (
  collection TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS v5_audit_log (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  detail TEXT
);

CREATE INDEX IF NOT EXISTS v5_audit_log_entity ON v5_audit_log (entity, entity_id);

-- Every issued Tax Invoice, exactly as issued. Insert-only; the unique
-- number is enforced here as well as in the application.
CREATE TABLE IF NOT EXISTS v5_tax_invoice_archive (
  id TEXT PRIMARY KEY,
  invoice_number TEXT NOT NULL UNIQUE,
  snapshot TEXT NOT NULL,
  issued_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS v5_tax_invoice_archive_no_update
BEFORE UPDATE ON v5_tax_invoice_archive
BEGIN
  SELECT RAISE(ABORT, 'issued tax invoices are immutable');
END;

CREATE TRIGGER IF NOT EXISTS v5_tax_invoice_archive_no_delete
BEFORE DELETE ON v5_tax_invoice_archive
BEGIN
  SELECT RAISE(ABORT, 'issued tax invoices are immutable');
END;
