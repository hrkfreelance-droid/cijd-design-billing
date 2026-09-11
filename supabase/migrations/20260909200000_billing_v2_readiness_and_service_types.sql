-- CIJD Billing V2: nullable prices, project billing readiness and a service master.
-- Additive migration. Existing clients, projects, items and invoices remain.

create table if not exists public.service_types (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint service_types_key_format check (key ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  constraint service_types_name_nonempty check (length(btrim(name)) > 0)
);

alter table public.service_types enable row level security;
drop policy if exists service_types_read on public.service_types;
create policy service_types_read on public.service_types
  for select to authenticated using (true);
drop policy if exists service_types_write on public.service_types;
create policy service_types_write on public.service_types
  for all to authenticated
  using (public.current_role_name() = 'ADMIN')
  with check (public.current_role_name() = 'ADMIN');

insert into public.service_types (key, name) values
  ('DESIGN', 'Design'),
  ('PRINTING', 'Printing'),
  ('PASSPORT', 'Passport'),
  ('OTHER', 'Other')
on conflict (key) do nothing;

alter table public.projects
  add column if not exists billing_readiness text not null default 'AUTO';
alter table public.projects drop constraint if exists projects_billing_readiness_check;
alter table public.projects add constraint projects_billing_readiness_check
  check (billing_readiness in ('AUTO', 'READY', 'IN_PROGRESS'));

alter table public.billing_items
  add column if not exists billing_override boolean not null default false;
alter table public.billing_items alter column amount drop not null;
alter table public.billing_items drop constraint if exists amount_is_not_negative;
alter table public.billing_items add constraint amount_is_not_negative
  check (amount is null or amount >= 0);
alter table public.billing_items drop constraint if exists billing_needs_delivery;
alter table public.billing_items add constraint billing_needs_delivery check (
  billing_status in ('NOT_READY', 'NEEDS_REVIEW')
  or production_status in ('DELIVERED', 'COMPLETED')
  or billing_override = true
);

-- A Billing V2 readiness decision permits billing without pretending production
-- is complete. The explicit item flag is only set by the readiness operation.
create or replace function public.set_project_billing_readiness(
  p_project_id uuid,
  p_readiness text,
  p_actor text
) returns public.projects
language plpgsql security invoker set search_path = public as $$
declare
  project_row public.projects;
  pending_count integer;
begin
  if p_readiness not in ('AUTO', 'READY', 'IN_PROGRESS') then
    raise exception 'INVALID' using detail = 'Invalid billing readiness.';
  end if;
  select * into project_row from public.projects
    where id = p_project_id and deleted_at is null for update;
  if not found then
    raise exception 'NOT_FOUND' using detail = 'Project was not found.';
  end if;
  if p_readiness = 'READY' then
    if not exists (
      select 1 from public.billing_items
      where project_id = p_project_id and deleted_at is null
        and billing_status not in ('INVOICED', 'PAID')
    ) then
      raise exception 'NO_ITEMS' using detail = 'Add what should be billed first.';
    end if;
    select count(*) into pending_count from public.billing_items
      where project_id = p_project_id and deleted_at is null
        and billing_status not in ('INVOICED', 'PAID') and amount is null;
    if pending_count > 0 then
      raise exception 'PRICE_REQUIRED' using detail = format('%s item still needs a billing price.', pending_count);
    end if;
  end if;

  update public.projects set
    billing_readiness = p_readiness,
    updated_at = now(),
    updated_by = p_actor
    where id = p_project_id
    returning * into project_row;

  if p_readiness in ('READY', 'IN_PROGRESS') then
    update public.billing_items set
      billing_status = case when p_readiness = 'READY' then 'READY_TO_INVOICE' else 'NOT_READY' end,
      billing_override = (p_readiness = 'READY'),
      updated_at = now(),
      updated_by = p_actor
      where project_id = p_project_id and deleted_at is null
        and billing_status not in ('INVOICED', 'PAID');
  else
    update public.billing_items set
      billing_override = false,
      updated_at = now(),
      updated_by = p_actor
      where project_id = p_project_id and deleted_at is null
        and billing_status not in ('INVOICED', 'PAID');
  end if;

  insert into public.audit_logs (actor, action, entity, entity_id, detail)
    values (p_actor, 'project.billingReadiness', 'project', p_project_id, p_readiness);
  return project_row;
end;
$$;

revoke all on function public.set_project_billing_readiness(uuid, text, text) from public, anon;
grant execute on function public.set_project_billing_readiness(uuid, text, text) to authenticated, service_role;

-- Invoice creation keeps the existing NBC snapshot behavior and all ordinary
-- production/printing gates. Only an explicit billing_override can bypass them.
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
  select count(*) into found_count from public.billing_items
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

  select * into rate_row from public.exchange_rates
    where currency_pair = 'USD/KHR' and source = 'NBC' and effective_date <= invoice_day
    order by effective_date desc limit 1;
  if not found then
    raise exception 'EXCHANGE_RATE_UNAVAILABLE'
      using detail = 'An official NBC USD/KHR rate is required before issuing an invoice.';
  end if;

  for item in select * from public.billing_items where id = any (p_item_ids) and deleted_at is null loop
    if not exists (select 1 from public.projects where id = item.project_id and client_id = p_client_id) then
      raise exception 'INVALID' using detail = 'All items must belong to the same client.';
    end if;
    if item.billing_status in ('INVOICED', 'PAID') then
      raise exception 'ALREADY_INVOICED' using detail = format('"%s" has already been invoiced.', item.description);
    end if;
    if item.amount is null then
      raise exception 'PRICE_REQUIRED' using detail = format('"%s" still needs a billing price.', item.description);
    end if;
    if not item.billing_override and item.production_status not in ('DELIVERED', 'COMPLETED') then
      raise exception 'NOT_DELIVERED' using detail = format('"%s" has not completed production yet.', item.description);
    end if;
    if not item.billing_override and item.type = 'PRINT'
       and lower(btrim(item.created_by)) <> 'import'
       and coalesce(to_jsonb(item)->>'price_review_status', 'REVIEW_REQUIRED') <> 'CONFIRMED' then
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
  update public.billing_items set
    billing_status = 'INVOICED', invoice_id = invoice.id,
    updated_at = now(), updated_by = p_actor
    where id = any (p_item_ids);
  insert into public.audit_logs (actor, action, entity, entity_id, detail)
    values (p_actor, 'invoice.create', 'invoice', invoice.id, invoice.invoice_number);
  return invoice;
end;
$$;

revoke all on function public.create_invoice(uuid, text, date, uuid[], text) from public, anon;
grant execute on function public.create_invoice(uuid, text, date, uuid[], text) to authenticated, service_role;
