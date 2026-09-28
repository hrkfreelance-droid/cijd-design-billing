-- Additive V4 tax-invoice ledger. Existing V3 tables and functions are untouched.
create type public.v4_tax_invoice_status as enum ('DRAFT', 'ISSUED', 'CANCELLED');
create type public.v4_tax_invoice_line_source as enum ('BILLING_ITEM', 'MANUAL');

create table public.v4_customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  khmer_name text,
  address text,
  phone text,
  vatin text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index v4_customers_name_idx on public.v4_customers (lower(name));

create table public.v4_tax_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text unique,
  status public.v4_tax_invoice_status not null default 'DRAFT',
  invoice_date date not null,
  customer_id uuid references public.v4_customers(id),
  customer_name text not null,
  customer_khmer_name text,
  customer_address text,
  customer_phone text,
  customer_vatin text,
  subtotal numeric(14,2) not null default 0,
  vat_rate numeric(6,4) not null default 0.1000,
  vat_amount numeric(14,2) not null default 0,
  usd_total numeric(14,2) not null default 0,
  exchange_rate numeric(14,4),
  exchange_rate_source text,
  exchange_rate_date date,
  exchange_rate_manual_override boolean not null default false,
  khr_total numeric(20,0),
  issued_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index v4_tax_invoices_number_live_idx on public.v4_tax_invoices(lower(invoice_number)) where invoice_number is not null;

create table public.v4_tax_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.v4_tax_invoices(id) on delete cascade,
  source_type public.v4_tax_invoice_line_source not null,
  billing_item_id uuid references public.billing_items(id),
  description text not null,
  quantity numeric(14,4) not null,
  unit_price numeric(14,2) not null,
  amount numeric(14,2) not null,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  constraint v4_line_source_fk check (source_type = 'MANUAL' or billing_item_id is not null)
);
create index v4_tax_invoice_lines_invoice_idx on public.v4_tax_invoice_lines(invoice_id, sort_order);

alter table public.v4_customers enable row level security;
alter table public.v4_tax_invoices enable row level security;
alter table public.v4_tax_invoice_lines enable row level security;

-- The issue transition is deliberately one database transaction. The row lock
-- makes the sequence allocation safe when two operators issue invoices at once.
create or replace function public.v4_issue_tax_invoice(p_invoice_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  draft public.v4_tax_invoices;
  next_number text;
  next_seq integer;
begin
  select * into draft from public.v4_tax_invoices where id = p_invoice_id for update;
  if not found then raise exception 'V4 invoice not found'; end if;
  if draft.status <> 'DRAFT' then raise exception 'Only Draft invoices can be issued'; end if;
  if not exists (select 1 from public.v4_tax_invoice_lines where invoice_id = p_invoice_id) then raise exception 'At least one line is required'; end if;
  next_seq := coalesce((select max((substring(invoice_number from 11))::integer) from public.v4_tax_invoices where invoice_number like 'CIJDTI' || extract(year from draft.invoice_date)::text || '%'), 0) + 1;
  next_number := 'CIJDTI' || extract(year from draft.invoice_date)::text || lpad(next_seq::text, 3, '0');
  update public.v4_tax_invoices set invoice_number = next_number, status = 'ISSUED', issued_at = now(), updated_at = now() where id = p_invoice_id;
  return p_invoice_id;
end;
$$;
