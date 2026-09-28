CREATE TABLE customers (
  id TEXT PRIMARY KEY NOT NULL,
  company_name_en TEXT NOT NULL DEFAULT '',
  company_name_km TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  address_en TEXT NOT NULL DEFAULT '',
  address_km TEXT NOT NULL DEFAULT '',
  telephone TEXT NOT NULL DEFAULT '',
  vatin TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (company_name_en <> '' OR company_name_km <> '')
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  deposit_cents INTEGER NOT NULL DEFAULT 0 CHECK (deposit_cents >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE billing_items (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  service_type TEXT NOT NULL,
  description TEXT NOT NULL,
  quantity_units INTEGER NOT NULL CHECK (quantity_units > 0),
  unit_cost_ticks INTEGER CHECK (unit_cost_ticks IS NULL OR unit_cost_ticks >= 0),
  total_cost_cents INTEGER CHECK (total_cost_cents IS NULL OR total_cost_cents >= 0),
  markup_override_hundredths INTEGER CHECK (markup_override_hundredths IS NULL OR markup_override_hundredths >= 0),
  recommended_total_cents INTEGER CHECK (recommended_total_cents IS NULL OR recommended_total_cents >= 0),
  final_unit_cents INTEGER NOT NULL CHECK (final_unit_cents >= 0),
  final_total_cents INTEGER NOT NULL CHECK (final_total_cents >= 0),
  final_mode TEXT NOT NULL CHECK (final_mode IN ('AUTO', 'UNIT', 'TOTAL')),
  readiness TEXT NOT NULL DEFAULT 'PENDING' CHECK (readiness IN ('PENDING', 'READY', 'INVOICED')),
  invoiced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE exchange_rates (
  id TEXT PRIMARY KEY NOT NULL,
  rate_scaled INTEGER NOT NULL CHECK (rate_scaled > 0),
  source TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  UNIQUE (source, effective_date)
);

CREATE TABLE tax_invoices (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ISSUED', 'CANCELLED')),
  invoice_number TEXT UNIQUE,
  invoice_date TEXT NOT NULL,
  customer_name_en TEXT NOT NULL DEFAULT '',
  customer_name_km TEXT NOT NULL DEFAULT '',
  customer_contact_name TEXT NOT NULL DEFAULT '',
  customer_address_en TEXT NOT NULL DEFAULT '',
  customer_address_km TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  customer_vatin TEXT NOT NULL DEFAULT '',
  subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  vat_rate_basis_points INTEGER NOT NULL DEFAULT 1000 CHECK (vat_rate_basis_points = 1000),
  vat_cents INTEGER NOT NULL DEFAULT 0 CHECK (vat_cents >= 0),
  usd_total_cents INTEGER NOT NULL DEFAULT 0 CHECK (usd_total_cents >= 0),
  exchange_rate_scaled INTEGER CHECK (exchange_rate_scaled IS NULL OR exchange_rate_scaled > 0),
  exchange_rate_source TEXT,
  exchange_rate_date TEXT,
  khr_total INTEGER CHECK (khr_total IS NULL OR khr_total >= 0),
  issued_at TEXT,
  cancelled_at TEXT,
  cancellation_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (status = 'DRAFT' AND invoice_number IS NULL AND issued_at IS NULL AND cancelled_at IS NULL)
    OR (status = 'ISSUED' AND invoice_number IS NOT NULL AND issued_at IS NOT NULL AND cancelled_at IS NULL)
    OR (status = 'CANCELLED' AND invoice_number IS NOT NULL AND issued_at IS NOT NULL AND cancelled_at IS NOT NULL AND length(trim(cancellation_reason)) > 0)
  )
);

CREATE TABLE tax_invoice_lines (
  id TEXT PRIMARY KEY NOT NULL,
  invoice_id TEXT NOT NULL REFERENCES tax_invoices(id) ON DELETE CASCADE,
  billing_item_id TEXT REFERENCES billing_items(id) ON DELETE RESTRICT,
  description TEXT NOT NULL,
  quantity_units INTEGER NOT NULL CHECK (quantity_units > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  sort_order INTEGER NOT NULL CHECK (sort_order > 0),
  created_at TEXT NOT NULL,
  UNIQUE (invoice_id, billing_item_id),
  UNIQUE (invoice_id, sort_order)
);

CREATE TABLE invoice_number_sequences (
  year INTEGER PRIMARY KEY NOT NULL,
  next_value INTEGER NOT NULL CHECK (next_value > 0)
);

INSERT INTO invoice_number_sequences (year, next_value) VALUES (2026, 81);

CREATE TABLE billing_item_claims (
  billing_item_id TEXT PRIMARY KEY NOT NULL REFERENCES billing_items(id) ON DELETE RESTRICT,
  invoice_id TEXT NOT NULL REFERENCES tax_invoices(id) ON DELETE RESTRICT,
  claimed_at TEXT NOT NULL
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX projects_customer_id_idx ON projects(customer_id);
CREATE INDEX billing_items_project_id_idx ON billing_items(project_id);
CREATE INDEX billing_items_readiness_idx ON billing_items(readiness);
CREATE INDEX tax_invoices_project_id_idx ON tax_invoices(project_id);
CREATE INDEX tax_invoices_status_idx ON tax_invoices(status);
CREATE INDEX tax_invoice_lines_invoice_id_idx ON tax_invoice_lines(invoice_id, sort_order);
CREATE INDEX audit_logs_entity_idx ON audit_logs(entity, entity_id, created_at DESC);

CREATE TRIGGER tax_invoice_status_transition_guard
BEFORE UPDATE OF status ON tax_invoices
WHEN NOT (
  (OLD.status = 'DRAFT' AND NEW.status IN ('ISSUED', 'CANCELLED'))
  OR (OLD.status = 'ISSUED' AND NEW.status = 'CANCELLED')
)
BEGIN
  SELECT RAISE(ABORT, 'Invalid tax invoice status transition');
END;

CREATE TRIGGER tax_invoice_issue_fields_guard
BEFORE UPDATE OF status ON tax_invoices
WHEN NEW.status = 'ISSUED' AND (
  NEW.invoice_number IS NULL OR NEW.issued_at IS NULL OR NEW.exchange_rate_scaled IS NULL
  OR NEW.exchange_rate_source IS NULL OR NEW.exchange_rate_date IS NULL OR NEW.khr_total IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'Issued invoice requires a number, issue timestamp, and exchange-rate snapshot');
END;

CREATE TRIGGER tax_invoice_issued_snapshot_guard
BEFORE UPDATE ON tax_invoices
WHEN OLD.status IN ('ISSUED', 'CANCELLED') AND (
  NEW.project_id IS NOT OLD.project_id OR NEW.customer_id IS NOT OLD.customer_id
  OR NEW.invoice_number IS NOT OLD.invoice_number OR NEW.invoice_date IS NOT OLD.invoice_date
  OR NEW.customer_name_en IS NOT OLD.customer_name_en OR NEW.customer_name_km IS NOT OLD.customer_name_km
  OR NEW.customer_contact_name IS NOT OLD.customer_contact_name
  OR NEW.customer_address_en IS NOT OLD.customer_address_en OR NEW.customer_address_km IS NOT OLD.customer_address_km
  OR NEW.customer_phone IS NOT OLD.customer_phone OR NEW.customer_vatin IS NOT OLD.customer_vatin
  OR NEW.subtotal_cents IS NOT OLD.subtotal_cents OR NEW.vat_rate_basis_points IS NOT OLD.vat_rate_basis_points
  OR NEW.vat_cents IS NOT OLD.vat_cents OR NEW.usd_total_cents IS NOT OLD.usd_total_cents
  OR NEW.exchange_rate_scaled IS NOT OLD.exchange_rate_scaled
  OR NEW.exchange_rate_source IS NOT OLD.exchange_rate_source OR NEW.exchange_rate_date IS NOT OLD.exchange_rate_date
  OR NEW.khr_total IS NOT OLD.khr_total OR NEW.issued_at IS NOT OLD.issued_at
)
BEGIN
  SELECT RAISE(ABORT, 'Issued invoice snapshots are immutable');
END;

CREATE TRIGGER tax_invoice_line_insert_guard
BEFORE INSERT ON tax_invoice_lines
WHEN COALESCE((SELECT status FROM tax_invoices WHERE id = NEW.invoice_id), '') <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'Issued invoice lines are immutable');
END;

CREATE TRIGGER tax_invoice_line_update_guard
BEFORE UPDATE ON tax_invoice_lines
WHEN COALESCE((SELECT status FROM tax_invoices WHERE id = NEW.invoice_id), '') <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'Issued invoice lines are immutable');
END;

CREATE TRIGGER tax_invoice_line_delete_guard
BEFORE DELETE ON tax_invoice_lines
WHEN COALESCE((SELECT status FROM tax_invoices WHERE id = OLD.invoice_id), '') <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'Issued invoice lines are immutable');
END;

CREATE TRIGGER billing_item_claim_ready_guard
BEFORE INSERT ON billing_item_claims
WHEN NOT EXISTS (
  SELECT 1 FROM billing_items b
  JOIN tax_invoices i ON i.id = NEW.invoice_id
  WHERE b.id = NEW.billing_item_id AND b.project_id = i.project_id AND b.readiness = 'READY'
)
BEGIN
  SELECT RAISE(ABORT, 'Every billing item must belong to the project and be READY');
END;

CREATE TRIGGER billing_item_invoiced_claim_guard
BEFORE UPDATE OF readiness ON billing_items
WHEN NEW.readiness = 'INVOICED' AND NOT EXISTS (
  SELECT 1 FROM billing_item_claims c WHERE c.billing_item_id = NEW.id
)
BEGIN
  SELECT RAISE(ABORT, 'An invoiced billing item must have an invoice claim');
END;
