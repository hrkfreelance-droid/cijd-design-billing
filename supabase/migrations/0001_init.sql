-- CIJD DESIGN Billing — schema.
--
-- The rules that protect money are constraints, not conventions: undelivered
-- work cannot be marked ready to invoice, a billing item can appear on only one
-- invoice, an invoice number is unique, and an invoice can have one live
-- payment. Even a compromised client cannot get around them.

create type production_status as enum ('IN_PROGRESS', 'DELIVERED');
create type billing_status as enum (
  'NOT_READY', 'READY_TO_INVOICE', 'INVOICED', 'PAID', 'NEEDS_REVIEW'
);
create type item_type as enum ('DESIGN', 'RESIZE', 'PRINT', 'OTHER');
create type invoice_status as enum ('ISSUED', 'PAID', 'VOID');
create type receipt_status as enum ('NOT_REQUIRED', 'PENDING', 'RECEIVED');
create type user_role as enum ('DESIGNER', 'BILLING', 'ACCOUNTING', 'ADMIN');
create type notification_status as enum ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- One row per signed-in person. The role lives here, never in a token claim
-- the browser could edit.
create table users (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  role user_role not null default 'DESIGNER',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index clients_name_unique on clients (lower(name));

create table projects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id),
  name text not null,
  date date not null default current_date,
  note text,
  created_at timestamptz not null default now(),
  created_by text not null,
  updated_at timestamptz not null default now(),
  updated_by text not null,
  deleted_at timestamptz
);
create index projects_client_idx on projects (client_id, date desc);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id),
  -- Historical imports may preserve a confirmed fact without recovering the
  -- administrative number or date. Live invoice creation still requires both.
  invoice_number text,
  invoice_date date,
  amount numeric(12, 2) not null,
  status invoice_status not null default 'ISSUED',
  payment_date date,
  payment_slip text,
  receipt_status receipt_status not null default 'PENDING',
  created_at timestamptz not null default now(),
  created_by text not null,
  updated_at timestamptz not null default now(),
  updated_by text not null
);
-- No two live invoices may share a number.
create unique index invoices_number_unique
  on invoices (lower(invoice_number))
  where status <> 'VOID';
create index invoices_client_idx on invoices (client_id, invoice_date desc);

create table billing_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id),
  description text not null,
  type item_type not null default 'OTHER',
  quantity numeric(12, 2) not null default 1,
  unit_price numeric(12, 2) not null default 0,
  amount numeric(12, 2) not null,
  custom_amount boolean not null default false,
  production_status production_status not null default 'IN_PROGRESS',
  billing_status billing_status not null default 'NOT_READY',
  delivered_at timestamptz,
  delivered_by text,
  invoice_id uuid references invoices (id),
  note text,
  created_at timestamptz not null default now(),
  created_by text not null,
  updated_at timestamptz not null default now(),
  updated_by text not null,
  deleted_at timestamptz,
  -- The delivery gate, in the database itself.
  constraint billing_needs_delivery check (
    billing_status in ('NOT_READY', 'NEEDS_REVIEW')
    or production_status = 'DELIVERED'
  ),
  -- Delivery and its stamp travel together.
  constraint delivery_is_stamped check (
    (production_status = 'DELIVERED') = (delivered_at is not null)
  ),
  -- An item is on an invoice if and only if it is invoiced or paid.
  constraint invoiced_items_have_an_invoice check (
    (billing_status in ('INVOICED', 'PAID')) = (invoice_id is not null)
  ),
  constraint amount_is_not_negative check (amount >= 0)
);
create index billing_items_project_idx on billing_items (project_id);
create index billing_items_status_idx on billing_items (billing_status);
create index billing_items_delivery_idx on billing_items (production_status);

create table invoice_items (
  invoice_id uuid not null references invoices (id) on delete cascade,
  billing_item_id uuid not null references billing_items (id),
  primary key (invoice_id, billing_item_id),
  -- A billing item can never appear on two invoices.
  unique (billing_item_id)
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices (id),
  amount numeric(12, 2) not null,
  -- A historical payment can be confirmed even when its date is unknown.
  paid_at date,
  slip text,
  created_at timestamptz not null default now(),
  created_by text not null,
  voided_at timestamptz,
  voided_by text
);
-- At most one live payment per invoice: no paying the same invoice twice.
create unique index payments_one_live_per_invoice
  on payments (invoice_id)
  where voided_at is null;

create table notification_logs (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'DELIVERY',
  -- Same delivery, same key: the notice is never sent twice.
  dedupe_key text not null unique,
  project_id uuid references projects (id),
  text text not null,
  status notification_status not null default 'PENDING',
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  entity text not null,
  entity_id uuid not null,
  detail text
);
create index audit_logs_entity_idx on audit_logs (entity, entity_id, at desc);

create table telegram_sessions (
  chat_id text primary key,
  last_project_id uuid references projects (id),
  candidate_ids uuid[] not null default '{}',
  pending_project_name text,
  updated_at timestamptz not null default now()
);
