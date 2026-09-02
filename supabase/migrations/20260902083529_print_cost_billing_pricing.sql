-- Separate internal printing cost from customer-facing billing price.
-- Applied to the CIJD Supabase project on 2026-09-02 as migration
-- `print_cost_billing_pricing`. This source file mirrors that production DDL.
-- Existing billing prices are not rewritten or guessed into cost fields.

alter table public.billing_items
  add column if not exists print_cost_unit_price numeric(12, 2),
  add column if not exists print_cost_amount numeric(12, 2),
  add column if not exists print_cost_confirmed_by text,
  add column if not exists print_cost_confirmed_at timestamptz,
  add column if not exists billing_price_manual boolean not null default false;

create or replace function public.round_print_billing_price(p_cost numeric)
returns numeric
language plpgsql
immutable
set search_path = public as $$
declare
  raw_price numeric;
  step_size numeric;
begin
  if p_cost is null or p_cost <= 0 then return 0; end if;
  raw_price := p_cost * case
    when p_cost <= 20 then 2.0
    when p_cost <= 100 then 1.7
    else 1.5
  end;
  step_size := case when raw_price <= 100 then 5 else 10 end;
  return ceil(raw_price / step_size) * step_size;
end;
$$;

create or replace function public.ensure_print_price_review() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.type = 'PRINT' and lower(btrim(new.created_by)) <> 'import' then
    new.price_review_status := 'REVIEW_REQUIRED';
    new.price_confirmed_by := null;
    new.price_confirmed_at := null;
    new.print_cost_confirmed_by := null;
    new.print_cost_confirmed_at := null;
    new.billing_price_manual := coalesce(new.billing_price_manual, false);
    if new.print_cost_amount is null then
      new.suggested_unit_price := null;
      new.suggested_amount := null;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.guard_printing_billing_item_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  role_name text := coalesce(public.current_role_name()::text, '');
  action_name text := coalesce(current_setting('cijd.printing_action', true), '');
begin
  if role_name <> 'PRINTING' then return new; end if;
  if old.type <> 'PRINT' or new.type <> 'PRINT'
     or lower(btrim(old.created_by)) = 'import'
     or old.billing_status in ('INVOICED','PAID') then
    raise exception 'FORBIDDEN';
  end if;

  if action_name = 'delivery' then
    if old.id is distinct from new.id
       or old.project_id is distinct from new.project_id
       or old.description is distinct from new.description
       or old.type is distinct from new.type
       or old.quantity is distinct from new.quantity
       or old.unit_price is distinct from new.unit_price
       or old.amount is distinct from new.amount
       or old.custom_amount is distinct from new.custom_amount
       or old.note is distinct from new.note
       or old.print_size is distinct from new.print_size
       or old.price_review_status is distinct from new.price_review_status
       or old.suggested_unit_price is distinct from new.suggested_unit_price
       or old.suggested_amount is distinct from new.suggested_amount
       or old.price_source is distinct from new.price_source
       or old.price_reason is distinct from new.price_reason
       or old.price_confirmed_by is distinct from new.price_confirmed_by
       or old.price_confirmed_at is distinct from new.price_confirmed_at
       or old.print_cost_unit_price is distinct from new.print_cost_unit_price
       or old.print_cost_amount is distinct from new.print_cost_amount
       or old.print_cost_confirmed_by is distinct from new.print_cost_confirmed_by
       or old.print_cost_confirmed_at is distinct from new.print_cost_confirmed_at
       or old.billing_price_manual is distinct from new.billing_price_manual
       or old.invoice_id is distinct from new.invoice_id
       or old.created_at is distinct from new.created_at
       or old.created_by is distinct from new.created_by
       or old.deleted_at is distinct from new.deleted_at then
      raise exception 'FORBIDDEN';
    end if;
  elsif action_name = 'price' then
    if old.id is distinct from new.id
       or old.project_id is distinct from new.project_id
       or old.description is distinct from new.description
       or old.type is distinct from new.type
       or old.quantity is distinct from new.quantity
       or old.production_status is distinct from new.production_status
       or old.delivered_at is distinct from new.delivered_at
       or old.delivered_by is distinct from new.delivered_by
       or old.invoice_id is distinct from new.invoice_id
       or old.created_at is distinct from new.created_at
       or old.created_by is distinct from new.created_by
       or old.deleted_at is distinct from new.deleted_at then
      raise exception 'FORBIDDEN';
    end if;
  elsif action_name = 'spec' then
    if old.id is distinct from new.id
       or old.project_id is distinct from new.project_id
       or old.type is distinct from new.type
       or old.production_status is distinct from new.production_status
       or old.delivered_at is distinct from new.delivered_at
       or old.delivered_by is distinct from new.delivered_by
       or old.invoice_id is distinct from new.invoice_id
       or old.created_at is distinct from new.created_at
       or old.created_by is distinct from new.created_by
       or old.deleted_at is distinct from new.deleted_at then
      raise exception 'FORBIDDEN';
    end if;
  else
    raise exception 'FORBIDDEN';
  end if;
  return new;
end;
$$;

create or replace function public.maintain_print_price_review() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  action_name text := coalesce(current_setting('cijd.printing_action', true), '');
  next_cost numeric;
  next_suggested numeric;
begin
  if new.type <> 'PRINT' or lower(btrim(new.created_by)) = 'import' then return new; end if;
  if action_name in ('price','spec') then return new; end if;

  if old.quantity is distinct from new.quantity
     or old.print_size is distinct from new.print_size
     or old.type is distinct from new.type then
    next_cost := case when new.print_cost_unit_price is not null then round(new.quantity * new.print_cost_unit_price, 2) else null end;
    next_suggested := case when next_cost is not null and next_cost > 0 then public.round_print_billing_price(next_cost) else null end;
    new.print_cost_amount := next_cost;
    new.suggested_amount := next_suggested;
    new.suggested_unit_price := case when next_suggested is not null and new.quantity > 0 then round(next_suggested / new.quantity, 2) else null end;
    new.price_review_status := 'REVIEW_REQUIRED';
    new.price_confirmed_by := null;
    new.price_confirmed_at := null;
    new.print_cost_confirmed_by := null;
    new.print_cost_confirmed_at := null;
    if new.billing_status = 'READY_TO_INVOICE' then new.billing_status := 'NEEDS_REVIEW'; end if;
    if not coalesce(new.billing_price_manual, false) and next_suggested is not null then
      new.amount := next_suggested;
      new.unit_price := round(next_suggested / new.quantity, 2);
      new.custom_amount := true;
    end if;
  elsif old.unit_price is distinct from new.unit_price or old.amount is distinct from new.amount then
    new.billing_price_manual := true;
  end if;
  return new;
end;
$$;

create or replace function public.update_print_spec(
  p_item_id uuid,
  p_description text,
  p_print_size text,
  p_quantity numeric,
  p_note text,
  p_actor text
) returns public.billing_items
language plpgsql set search_path = public as $$
declare
  item public.billing_items;
  actor_name text := coalesce((select name from public.users where id = auth.uid()), nullif(btrim(p_actor), ''), 'Unknown');
  next_description text;
  next_size text;
  next_note text;
  next_quantity numeric;
  next_cost numeric;
  next_suggested numeric;
begin
  if auth.role() <> 'service_role' and coalesce(public.current_role_name()::text,'') not in ('DESIGNER','PRINTING','ADMIN') then raise exception 'FORBIDDEN'; end if;
  select * into item from public.billing_items where id = p_item_id and deleted_at is null;
  if not found then raise exception 'NOT_FOUND' using detail = 'Billing item was not found.'; end if;
  if item.type <> 'PRINT' then raise exception 'INVALID_PRINT'; end if;
  if lower(btrim(item.created_by)) = 'import' then raise exception 'HISTORY_READ_ONLY'; end if;
  if item.billing_status in ('INVOICED','PAID') then raise exception 'ITEM_LOCKED'; end if;

  next_description := case when p_description is null then item.description else nullif(btrim(p_description), '') end;
  if next_description is null then raise exception 'INVALID' using detail = 'Description is required.'; end if;
  next_size := case when p_print_size is null then item.print_size else nullif(btrim(p_print_size), '') end;
  next_note := case when p_note is null then item.note else nullif(btrim(p_note), '') end;
  next_quantity := coalesce(p_quantity, item.quantity);
  if next_quantity <= 0 then raise exception 'INVALID' using detail = 'Quantity must be greater than zero.'; end if;

  next_cost := case when item.print_cost_unit_price is not null then round(next_quantity * item.print_cost_unit_price, 2) else null end;
  next_suggested := case when next_cost is not null and next_cost > 0 then public.round_print_billing_price(next_cost) else null end;

  perform set_config('cijd.printing_action', 'spec', true);
  update public.billing_items set
    description = next_description,
    print_size = next_size,
    quantity = next_quantity,
    note = next_note,
    print_cost_amount = next_cost,
    suggested_amount = next_suggested,
    suggested_unit_price = case when next_suggested is not null then round(next_suggested / next_quantity, 2) else null end,
    amount = case when not coalesce(billing_price_manual,false) and next_suggested is not null then next_suggested else amount end,
    unit_price = case when not coalesce(billing_price_manual,false) and next_suggested is not null then round(next_suggested / next_quantity,2) else unit_price end,
    custom_amount = case when not coalesce(billing_price_manual,false) and next_suggested is not null then true else custom_amount end,
    price_review_status = case when next_quantity is distinct from item.quantity then 'REVIEW_REQUIRED'::public.price_review_status else price_review_status end,
    price_confirmed_by = case when next_quantity is distinct from item.quantity then null else price_confirmed_by end,
    price_confirmed_at = case when next_quantity is distinct from item.quantity then null else price_confirmed_at end,
    print_cost_confirmed_by = case when next_quantity is distinct from item.quantity then null else print_cost_confirmed_by end,
    print_cost_confirmed_at = case when next_quantity is distinct from item.quantity then null else print_cost_confirmed_at end,
    billing_status = case
      when next_quantity is distinct from item.quantity and production_status in ('DELIVERED','COMPLETED') then 'NEEDS_REVIEW'::public.billing_status
      else billing_status
    end,
    updated_at = now(),
    updated_by = actor_name
  where id = p_item_id returning * into item;

  insert into public.audit_logs (actor, action, entity, entity_id, detail)
  values (actor_name, 'print.spec.update', 'billing_item', item.id, item.description);
  return item;
end;
$$;

create or replace function public.review_print_price(
  p_item_id uuid,
  p_unit_price numeric,
  p_amount numeric,
  p_confirm boolean,
  p_price_source text,
  p_price_reason text,
  p_actor text
) returns public.billing_items
language plpgsql set search_path = public as $$
declare
  item public.billing_items;
  actor_name text := coalesce((select name from public.users where id = auth.uid()), nullif(btrim(p_actor), ''), 'Unknown');
  suggested_total numeric;
  suggested_unit numeric;
begin
  if auth.role() <> 'service_role' and coalesce(public.current_role_name()::text,'') not in ('DESIGNER','PRINTING','ADMIN') then raise exception 'FORBIDDEN'; end if;
  select * into item from public.billing_items where id = p_item_id and deleted_at is null;
  if not found then raise exception 'NOT_FOUND' using detail = 'Billing item was not found.'; end if;
  if item.type <> 'PRINT' then raise exception 'INVALID_PRINT'; end if;
  if lower(btrim(item.created_by)) = 'import' then raise exception 'HISTORY_READ_ONLY'; end if;
  if item.billing_status in ('INVOICED','PAID') then raise exception 'ITEM_LOCKED'; end if;
  if p_unit_price is null or p_unit_price <= 0 or p_amount is null or p_amount <= 0 then
    raise exception 'INVALID' using detail = 'Print cost must be greater than zero.';
  end if;
  if round(p_amount,2) <> round(item.quantity * p_unit_price,2) then
    raise exception 'INVALID' using detail = 'Print cost total must equal quantity × cost per unit.';
  end if;

  suggested_total := public.round_print_billing_price(round(p_amount,2));
  suggested_unit := round(suggested_total / item.quantity, 2);

  perform set_config('cijd.printing_action', 'price', true);
  update public.billing_items set
    print_cost_unit_price = round(p_unit_price,2),
    print_cost_amount = round(p_amount,2),
    print_cost_confirmed_by = case when coalesce(p_confirm,false) then actor_name else null end,
    print_cost_confirmed_at = case when coalesce(p_confirm,false) then now() else null end,
    suggested_unit_price = suggested_unit,
    suggested_amount = suggested_total,
    unit_price = case when coalesce(billing_price_manual,false) then unit_price else suggested_unit end,
    amount = case when coalesce(billing_price_manual,false) then amount else suggested_total end,
    custom_amount = case when coalesce(billing_price_manual,false) then custom_amount else true end,
    price_source = case when p_price_source is null then price_source else nullif(btrim(p_price_source), '') end,
    price_reason = coalesce(nullif(btrim(p_price_reason), ''), format('Cost %s → suggested billing %s', round(p_amount,2), suggested_total)),
    price_review_status = case when coalesce(p_confirm,false) then 'CONFIRMED' else 'REVIEW_REQUIRED' end,
    price_confirmed_by = case when coalesce(p_confirm,false) then actor_name else null end,
    price_confirmed_at = case when coalesce(p_confirm,false) then now() else null end,
    billing_status = case
      when not coalesce(p_confirm,false) and production_status in ('DELIVERED','COMPLETED') then 'NEEDS_REVIEW'::public.billing_status
      when coalesce(p_confirm,false) and production_status in ('DELIVERED','COMPLETED') and billing_status in ('NOT_READY','NEEDS_REVIEW') then 'READY_TO_INVOICE'::public.billing_status
      else billing_status
    end,
    updated_at = now(),
    updated_by = actor_name
  where id = p_item_id returning * into item;

  insert into public.audit_logs (actor, action, entity, entity_id, detail)
  values (
    actor_name,
    case when coalesce(p_confirm,false) then 'print.cost.confirm' else 'print.cost.edit' end,
    'billing_item',
    item.id,
    format('cost=%s suggested=%s final=%s', item.print_cost_amount, item.suggested_amount, item.amount)
  );
  return item;
end;
$$;

create or replace function public.set_billing_price(
  p_item_id uuid,
  p_amount numeric,
  p_actor text
) returns public.billing_items
language plpgsql set search_path = public as $$
declare
  item public.billing_items;
  actor_name text := coalesce((select name from public.users where id = auth.uid()), nullif(btrim(p_actor), ''), 'Unknown');
  next_amount numeric;
  next_unit numeric;
begin
  if auth.role() <> 'service_role' and coalesce(public.current_role_name()::text,'') not in ('DESIGNER','BILLING','ADMIN') then raise exception 'FORBIDDEN'; end if;
  select * into item from public.billing_items where id = p_item_id and deleted_at is null;
  if not found then raise exception 'NOT_FOUND' using detail = 'Billing item was not found.'; end if;
  if lower(btrim(item.created_by)) = 'import' then raise exception 'HISTORY_READ_ONLY'; end if;
  if item.billing_status in ('INVOICED','PAID') then raise exception 'ITEM_LOCKED'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID' using detail = 'Billing price must be greater than zero.'; end if;
  if item.quantity <= 0 then raise exception 'INVALID' using detail = 'Quantity must be greater than zero.'; end if;

  next_amount := round(p_amount,2);
  next_unit := round(next_amount / item.quantity,2);
  perform set_config('cijd.billing_action', 'price', true);
  update public.billing_items set
    amount = next_amount,
    unit_price = next_unit,
    custom_amount = true,
    billing_price_manual = true,
    updated_at = now(),
    updated_by = actor_name
  where id = p_item_id returning * into item;

  insert into public.audit_logs (actor, action, entity, entity_id, detail)
  values (actor_name, 'billing.price.override', 'billing_item', item.id,
          format('suggested=%s final=%s', item.suggested_amount, item.amount));
  return item;
end;
$$;

revoke all on function public.round_print_billing_price(numeric) from public, anon;
revoke all on function public.update_print_spec(uuid, text, text, numeric, text, text) from public, anon;
revoke all on function public.review_print_price(uuid, numeric, numeric, boolean, text, text, text) from public, anon;
revoke all on function public.set_billing_price(uuid, numeric, text) from public, anon;

grant execute on function public.round_print_billing_price(numeric) to authenticated, service_role;
grant execute on function public.update_print_spec(uuid, text, text, numeric, text, text) to authenticated, service_role;
grant execute on function public.review_print_price(uuid, numeric, numeric, boolean, text, text, text) to authenticated, service_role;
grant execute on function public.set_billing_price(uuid, numeric, text) to authenticated, service_role;
