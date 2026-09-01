-- Store the official NBC USD/KHR snapshot without changing existing records.
-- The scheduled Worker writes these tables with the service role. Signed-in
-- users may read successful rates, but fetch failures stay internal.

create table if not exists public.exchange_rates (
  id uuid primary key default gen_random_uuid(),
  currency_pair text not null default 'USD/KHR',
  rate numeric(12, 4) not null check (rate > 0),
  source text not null default 'NBC',
  effective_date date not null,
  fetched_at timestamptz not null default now(),
  unique (currency_pair, effective_date),
  constraint exchange_rates_pair_check check (currency_pair = 'USD/KHR'),
  constraint exchange_rates_source_check check (source = 'NBC')
);

create index if not exists exchange_rates_latest_idx
  on public.exchange_rates (currency_pair, effective_date desc);

create table if not exists public.exchange_rate_fetch_failures (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'NBC',
  effective_date date not null,
  attempted_at timestamptz not null default now(),
  error text not null,
  unique (source, effective_date),
  constraint exchange_rate_failures_source_check check (source = 'NBC')
);

alter table public.invoices
  add column if not exists exchange_rate numeric(12, 4),
  add column if not exists exchange_rate_source text,
  add column if not exists exchange_rate_effective_date date,
  add column if not exists exchange_rate_fetched_at timestamptz;

create index if not exists invoices_exchange_rate_date_idx
  on public.invoices (exchange_rate_effective_date);

alter table public.exchange_rates enable row level security;
alter table public.exchange_rate_fetch_failures enable row level security;

drop policy if exists exchange_rates_read on public.exchange_rates;
create policy exchange_rates_read on public.exchange_rates
  for select to authenticated using (true);

drop policy if exists exchange_rates_admin_write on public.exchange_rates;

-- No authenticated policy is intentional: this is an internal operational log.
grant select on public.exchange_rates to authenticated;
grant all on public.exchange_rates, public.exchange_rate_fetch_failures to service_role;

-- New invoices take the latest successful rate available on or before the
-- creation day in Cambodia. Older invoices are never recalculated.
create or replace function public.create_invoice(
  p_client_id uuid,
  p_invoice_number text,
  p_invoice_date date,
  p_item_ids uuid[],
  p_actor text
) returns public.invoices
language plpgsql security invoker set search_path = public as $$
declare
  invoice public.invoices;
  item public.billing_items;
  rate_row public.exchange_rates;
  total numeric(12, 2) := 0;
  requested_count integer;
  found_count integer;
  invoice_day date := (now() at time zone 'Asia/Phnom_Penh')::date;
begin
  if p_invoice_number is null or btrim(p_invoice_number) = '' then
    raise exception 'INVALID' using detail = 'Invoice number is required.';
  end if;
  if p_item_ids is null or array_length(p_item_ids, 1) is null then
    raise exception 'INVALID' using detail = 'Select at least one item.';
  end if;
  select count(*) into requested_count from unnest(p_item_ids) as requested(id);
  select count(*) into found_count
    from public.billing_items
    where id = any (p_item_ids) and deleted_at is null;
  if found_count <> requested_count then
    raise exception 'NOT_FOUND' using detail = 'One or more billing items were not found.';
  end if;
  if exists (
    select 1 from public.invoices
    where status <> 'VOID' and lower(invoice_number) = lower(btrim(p_invoice_number))
  ) then
    raise exception 'DUPLICATE_INVOICE_NUMBER' using detail = 'That invoice number is already in use.';
  end if;

  select * into rate_row
    from public.exchange_rates
    where currency_pair = 'USD/KHR'
      and source = 'NBC'
      and effective_date <= invoice_day
    order by effective_date desc
    limit 1;
  if not found then
    raise exception 'EXCHANGE_RATE_UNAVAILABLE'
      using detail = 'An official NBC USD/KHR rate is required before issuing an invoice.';
  end if;

  for item in
    select * from public.billing_items where id = any (p_item_ids) and deleted_at is null
  loop
    if not exists (
      select 1 from public.projects where id = item.project_id and client_id = p_client_id
    ) then
      raise exception 'INVALID' using detail = 'All items must belong to the same client.';
    end if;
    if item.billing_status in ('INVOICED', 'PAID') then raise exception 'ALREADY_INVOICED'; end if;
    if item.production_status not in ('DELIVERED', 'COMPLETED') then
      raise exception 'NOT_DELIVERED' using detail = format('"%s" has not completed production yet.', item.description);
    end if;
    if item.type = 'PRINT'
       and lower(btrim(item.created_by)) <> 'import'
       and coalesce(item.price_review_status, 'REVIEW_REQUIRED') <> 'CONFIRMED'::public.price_review_status then
      raise exception 'PRICE_REVIEW_REQUIRED' using detail = format('"%s" needs a confirmed print price first.', item.description);
    end if;
    if item.billing_status <> 'READY_TO_INVOICE' then
      raise exception 'NOT_READY' using detail = format('"%s" is not ready to invoice yet.', item.description);
    end if;
    total := total + item.amount;
  end loop;

  insert into public.invoices (
    client_id, invoice_number, invoice_date, amount, exchange_rate,
    exchange_rate_source, exchange_rate_effective_date, exchange_rate_fetched_at,
    status, receipt_status, created_by, updated_by
  ) values (
    p_client_id, btrim(p_invoice_number), invoice_day, total, rate_row.rate,
    rate_row.source, rate_row.effective_date, rate_row.fetched_at,
    'ISSUED', 'PENDING', p_actor, p_actor
  ) returning * into invoice;
  insert into public.invoice_items (invoice_id, billing_item_id)
    select invoice.id, unnest(p_item_ids);
  update public.billing_items
    set billing_status = 'INVOICED', invoice_id = invoice.id,
        updated_at = now(), updated_by = p_actor
    where id = any (p_item_ids);
  insert into public.audit_logs (actor, action, entity, entity_id, detail)
    values (p_actor, 'invoice.create', 'invoice', invoice.id, invoice.invoice_number);
  return invoice;
end;
$$;

revoke all on function public.create_invoice(uuid, text, date, uuid[], text) from public, anon;
grant execute on function public.create_invoice(uuid, text, date, uuid[], text)
  to authenticated, service_role;
