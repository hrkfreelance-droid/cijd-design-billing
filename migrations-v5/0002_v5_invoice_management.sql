-- CIJD Billing V5 — invoice management (additive).
-- Invoices are editable; every revision is kept here, insert-only, as the
-- immutable audit trail. The existing v5_tax_invoice_archive keeps each
-- invoice exactly as first issued. Nothing existing is altered or dropped.

CREATE TABLE IF NOT EXISTS v5_invoice_revisions (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  action TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  snapshot TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS v5_invoice_revisions_invoice ON v5_invoice_revisions (invoice_id, revision);

CREATE TRIGGER IF NOT EXISTS v5_invoice_revisions_no_update
BEFORE UPDATE ON v5_invoice_revisions
BEGIN
  SELECT RAISE(ABORT, 'invoice revisions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS v5_invoice_revisions_no_delete
BEFORE DELETE ON v5_invoice_revisions
BEGIN
  SELECT RAISE(ABORT, 'invoice revisions are immutable');
END;
