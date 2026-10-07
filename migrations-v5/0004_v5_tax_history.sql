-- V5 only, additive. Every historical/reserved/issued number has one owner.
CREATE TABLE IF NOT EXISTS v5_invoice_numbers (
 invoice_number TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 reserved_at TEXT NOT NULL
);
INSERT OR IGNORE INTO v5_invoice_numbers (invoice_number,owner_id,reserved_at)
 SELECT invoice_number,id,issued_at FROM v5_tax_invoice_archive;
CREATE TRIGGER IF NOT EXISTS v5_invoice_numbers_owner_immutable
 BEFORE UPDATE ON v5_invoice_numbers WHEN NEW.owner_id != OLD.owner_id
 BEGIN SELECT RAISE(ABORT,'invoice number already consumed'); END;
CREATE TRIGGER IF NOT EXISTS v5_invoice_numbers_no_delete
 BEFORE DELETE ON v5_invoice_numbers
 BEGIN SELECT RAISE(ABORT,'invoice numbers cannot be reused'); END;
