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

-- V4 Preview/Pilot persistence is server-only. Keep the new ledger inaccessible
-- to browser anon/authenticated roles and allow the server service role.
revoke all privileges on table public.v4_customers from anon, authenticated;
revoke all privileges on table public.v4_tax_invoices from anon, authenticated;
revoke all privileges on table public.v4_tax_invoice_lines from anon, authenticated;
grant select, insert, update, delete on table public.v4_customers to service_role;
grant select, insert, update, delete on table public.v4_tax_invoices to service_role;
grant select, insert, update, delete on table public.v4_tax_invoice_lines to service_role;

-- Issue is one database transaction. A per-year advisory lock serializes number
-- allocation. The verified 2026 legacy workbook reserves sequences through 080,
-- so new 2026 invoices begin at 081 even though legacy rows are not imported.
create or replace function public.v4_issue_tax_invoice(p_invoice_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  draft public.v4_tax_invoices;
  snapshot public.v4_customers;
  issue_year integer;
  legacy_floor integer;
  next_number text;
  next_seq integer;
  calc_subtotal numeric(14,2);
  calc_vat numeric(14,2);
  calc_usd numeric(14,2);
  calc_khr numeric(20,0);
begin
  select * into draft
  from public.v4_tax_invoices
  where id = p_invoice_id
  for update;

  if not found then
    raise exception 'V4 invoice not found';
  end if;
  if draft.status <> 'DRAFT' then
    raise exception 'Only Draft invoices can be issued';
  end if;
  if nullif(btrim(draft.customer_name), '') is null then
    raise exception 'Customer is required';
  end if;
  if draft.exchange_rate is not null and draft.exchange_rate <= 0 then
    raise exception 'Exchange rate is invalid';
  end if;
  if not exists (
    select 1 from public.v4_tax_invoice_lines where invoice_id = p_invoice_id
  ) then
    raise exception 'At least one line is required';
  end if;
  if exists (
    select 1
    from public.v4_tax_invoice_lines
    where invoice_id = p_invoice_id
      and (
        nullif(btrim(description), '') is null
        or quantity < 0
        or unit_price < 0
      )
  ) then
    raise exception 'Invoice line is invalid';
  end if;

  -- Recalculate line amounts and totals authoritatively at issue time.
  update public.v4_tax_invoice_lines
  set amount = round(quantity * unit_price, 2)
  where invoice_id = p_invoice_id;

  select coalesce(sum(amount), 0)::numeric(14,2)
  into calc_subtotal
  from public.v4_tax_invoice_lines
  where invoice_id = p_invoice_id;

  calc_vat := round(calc_subtotal * 0.10, 2);
  calc_usd := calc_subtotal + calc_vat;
  calc_khr := case
    when draft.exchange_rate is null then null
    else round(calc_usd * draft.exchange_rate)::numeric(20,0)
  end;

  -- Refresh the customer snapshot at issue time when a customer master is linked.
  if draft.customer_id is not null then
    select * into snapshot
    from public.v4_customers
    where id = draft.customer_id;

    if not found then
      raise exception 'V4 customer not found';
    end if;
  end if;

  issue_year := extract(year from draft.invoice_date)::integer;
  legacy_floor := case when issue_year = 2026 then 80 else 0 end;

  perform pg_advisory_xact_lock(
    hashtextextended('v4-tax-invoice-' || issue_year::text, 0)
  );

  select greatest(
    coalesce(
      max((substring(invoice_number from 11))::integer)
        filter (
          where invoice_number ~ ('^CIJDTI' || issue_year::text || '[0-9]{3}$')
        ),
      0
    ),
    legacy_floor
  ) + 1
  into next_seq
  from public.v4_tax_invoices;

  if next_seq > 999 then
    raise exception 'Invoice sequence exhausted for year %', issue_year;
  end if;

  next_number := 'CIJDTI'
    || issue_year::text
    || lpad(next_seq::text, 3, '0');

  update public.v4_tax_invoices
  set
    invoice_number = next_number,
    status = 'ISSUED',
    customer_name = case when draft.customer_id is null then draft.customer_name else snapshot.name end,
    customer_khmer_name = case when draft.customer_id is null then draft.customer_khmer_name else snapshot.khmer_name end,
    customer_address = case when draft.customer_id is null then draft.customer_address else snapshot.address end,
    customer_phone = case when draft.customer_id is null then draft.customer_phone else snapshot.phone end,
    customer_vatin = case when draft.customer_id is null then draft.customer_vatin else snapshot.vatin end,
    subtotal = calc_subtotal,
    vat_rate = 0.1000,
    vat_amount = calc_vat,
    usd_total = calc_usd,
    khr_total = calc_khr,
    issued_at = now(),
    updated_at = now()
  where id = p_invoice_id;

  return p_invoice_id;
end;
$$;

revoke all on function public.v4_issue_tax_invoice(uuid) from public, anon, authenticated;
grant execute on function public.v4_issue_tax_invoice(uuid) to service_role;
