-- Keep the physical printing cost separate from the Billing selling price.
-- Existing rows keep their final price. The app reads legacy print-cost totals
-- as a compatibility fallback; no existing billing row is bulk-rewritten here.
alter table public.billing_items
  add column if not exists print_cost numeric(12, 2);
alter table public.billing_items
  add column if not exists print_cost_unit_price numeric;
alter table public.billing_items
  add column if not exists print_cost_amount numeric;
alter table public.billing_items
  add column if not exists print_cost_confirmed_by text;
alter table public.billing_items
  add column if not exists print_cost_confirmed_at timestamptz;
alter table public.billing_items
  add column if not exists billing_price_manual boolean not null default false;

alter table public.billing_items
  drop constraint if exists billing_items_print_cost_nonnegative;
alter table public.billing_items
  add constraint billing_items_print_cost_nonnegative check (print_cost is null or print_cost >= 0) not valid;

create or replace function public.ensure_print_price_review() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  suggested numeric;
begin
  if new.type = 'PRINT' and lower(btrim(new.created_by)) <> 'import' then
    new.price_review_status := 'REVIEW_REQUIRED';
    new.price_confirmed_by := null;
    new.price_confirmed_at := null;
    new.print_cost_confirmed_by := null;
    new.print_cost_confirmed_at := null;
    new.billing_price_manual := coalesce(new.billing_price_manual, false);
    if new.print_cost is not null then
      suggested := ceil((new.print_cost / (1 - case when new.print_cost <= 50 then 0.5 when new.print_cost <= 100 then 0.4 else 0.3 end) - 0.000000001) / 5) * 5;
      new.suggested_amount := suggested;
      new.suggested_unit_price := case when new.quantity > 0 then round(suggested / new.quantity, 2) else null end;
      if not new.billing_price_manual then
        new.amount := suggested;
        new.unit_price := case when new.quantity > 0 then round(suggested / new.quantity, 2) else new.unit_price end;
      end if;
    else
      new.suggested_unit_price := null;
      new.suggested_amount := null;
    end if;
  end if;
  return new;
end;
$$;

-- A cost edit is another price suggestion, except when Billing already owns a
-- deliberate custom amount. In that case amount remains the manual override.
create or replace function public.maintain_print_price_review() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.type = 'PRINT'
     and lower(btrim(new.created_by)) <> 'import'
     and coalesce(current_setting('cijd.printing_action', true), '') not in ('price', 'spec')
     and coalesce(current_setting('cijd.billing_action', true), '') <> 'billing_price'
     and (
       old.type is distinct from new.type
       or old.quantity is distinct from new.quantity
       or old.unit_price is distinct from new.unit_price
       or old.amount is distinct from new.amount
       or old.custom_amount is distinct from new.custom_amount
       or old.billing_price_manual is distinct from new.billing_price_manual
       or old.print_cost is distinct from new.print_cost
       or old.print_size is distinct from new.print_size
     ) then
    new.price_review_status := 'REVIEW_REQUIRED';
    new.suggested_unit_price := case
      when coalesce(new.billing_price_manual, false) then coalesce(old.suggested_unit_price, old.unit_price)
      else new.unit_price
    end;
    new.suggested_amount := case
      when coalesce(new.billing_price_manual, false) then coalesce(old.suggested_amount, old.amount)
      else new.amount
    end;
    new.price_confirmed_by := null;
    new.price_confirmed_at := null;
    if new.billing_status = 'READY_TO_INVOICE' then
      new.billing_status := 'NEEDS_REVIEW';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.update_print_spec(
  p_item_id uuid,
  p_description text,
  p_print_size text,
  p_quantity numeric,
  p_print_cost numeric,
  p_note text,
  p_actor text
) returns public.billing_items
language plpgsql security invoker set search_path = public as $$
declare
  item public.billing_items;
  actor_name text := coalesce((select name from public.users where id = auth.uid()), nullif(btrim(p_actor), ''), 'Unknown');
  next_description text;
  next_size text;
  next_note text;
  next_quantity numeric;
  next_cost numeric;
  next_suggested numeric;
  next_amount numeric;
  preserve_manual boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and (current_role_name() is null or current_role_name() not in ('DESIGNER', 'PRINTING', 'ADMIN')) then
    raise exception 'FORBIDDEN';
  end if;
  select * into item from public.billing_items where id = p_item_id and deleted_at is null;
  if not found then raise exception 'NOT_FOUND' using detail = 'Billing item was not found.'; end if;
  if item.type <> 'PRINT' then raise exception 'INVALID_PRINT'; end if;
  if lower(btrim(item.created_by)) = 'import' then raise exception 'HISTORY_READ_ONLY'; end if;
  if item.billing_status in ('INVOICED', 'PAID') then raise exception 'ITEM_LOCKED'; end if;

  next_description := case when p_description is null then item.description else nullif(btrim(p_description), '') end;
  if next_description is null then raise exception 'INVALID' using detail = 'Description is required.'; end if;
  next_size := case when p_print_size is null then item.print_size else nullif(btrim(p_print_size), '') end;
  next_note := case when p_note is null then item.note else nullif(btrim(p_note), '') end;
  next_quantity := coalesce(p_quantity, item.quantity);
  if next_quantity <= 0 then raise exception 'INVALID' using detail = 'Quantity must be greater than zero.'; end if;
  next_cost := case when p_print_cost is null then item.print_cost else round(p_print_cost, 2) end;
  if next_cost is not null and next_cost < 0 then raise exception 'INVALID' using detail = 'Printing cost must be zero or more.'; end if;

  next_suggested := case
    when next_cost is not null then ceil((next_cost / (1 - case when next_cost <= 50 then 0.5 when next_cost <= 100 then 0.4 else 0.3 end) - 0.000000001) / 5) * 5
    else round(next_quantity * item.unit_price, 2)
  end;
  preserve_manual := coalesce(item.billing_price_manual, false);
  next_amount := case when preserve_manual then item.amount else next_suggested end;

  perform set_config('cijd.printing_action', 'spec', true);
  update public.billing_items set
    description = next_description,
    print_size = next_size,
    print_cost = next_cost,
    quantity = next_quantity,
    note = next_note,
    amount = next_amount,
    billing_price_manual = preserve_manual,
    price_review_status = case when preserve_manual and item.price_review_status = 'CONFIRMED' then item.price_review_status else 'REVIEW_REQUIRED' end,
    suggested_unit_price = round(next_suggested / next_quantity, 2),
    suggested_amount = next_suggested,
    price_confirmed_by = case when preserve_manual and item.price_review_status = 'CONFIRMED' then item.price_confirmed_by else null end,
    price_confirmed_at = case when preserve_manual and item.price_review_status = 'CONFIRMED' then item.price_confirmed_at else null end,
    billing_status = case
      when preserve_manual and item.price_review_status = 'CONFIRMED' then item.billing_status
      when item.billing_status = 'READY_TO_INVOICE' then 'NEEDS_REVIEW'::public.billing_status
      else item.billing_status
    end,
    updated_at = now(), updated_by = actor_name
  where id = p_item_id
  returning * into item;
  insert into public.audit_logs (actor, action, entity, entity_id, detail)
  values (actor_name, 'print.spec.update', 'billing_item', item.id, item.description);
  insert into public.audit_logs (actor, action, entity, entity_id, detail)
  values (actor_name, 'price.suggested', 'billing_item', item.id, coalesce(item.price_reason, item.description));
  return item;
end;
$$;

create or replace function public.review_print_price(
  p_item_id uuid,
  p_unit_price numeric,
  p_amount numeric,
  p_print_cost numeric,
  p_confirm boolean,
  p_price_source text,
  p_price_reason text,
  p_actor text
) returns public.billing_items
language plpgsql security invoker set search_path = public as $$
declare
  item public.billing_items;
  actor_name text := coalesce((select name from public.users where id = auth.uid()), nullif(btrim(p_actor), ''), 'Unknown');
  expected_amount numeric;
  preserve_manual boolean;
  next_amount numeric;
  next_unit_price numeric;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and (current_role_name() is null or current_role_name() not in ('PRINTING', 'ADMIN')) then
    raise exception 'FORBIDDEN';
  end if;
  select * into item from public.billing_items where id = p_item_id and deleted_at is null;
  if not found then raise exception 'NOT_FOUND' using detail = 'Billing item was not found.'; end if;
  if item.type <> 'PRINT' then raise exception 'INVALID_PRINT'; end if;
  if lower(btrim(item.created_by)) = 'import' then raise exception 'HISTORY_READ_ONLY'; end if;
  if item.billing_status in ('INVOICED', 'PAID') then raise exception 'ITEM_LOCKED'; end if;
  if p_unit_price is null or p_unit_price <= 0 or p_amount is null or p_amount <= 0 then
    raise exception 'INVALID' using detail = 'A confirmed print price must be greater than zero.';
  end if;
  expected_amount := case
    when p_print_cost is not null then ceil((p_print_cost / (1 - case when p_print_cost <= 50 then 0.5 when p_print_cost <= 100 then 0.4 else 0.3 end) - 0.000000001) / 5) * 5
    else round(item.quantity * p_unit_price, 2)
  end;
  if p_print_cost is not null and p_print_cost < 0 then raise exception 'INVALID' using detail = 'Printing cost must be zero or more.'; end if;
  if round(p_amount, 2) <> round(expected_amount, 2) then
    raise exception 'INVALID' using detail = 'Print total does not match the printing cost rule.';
  end if;

  preserve_manual := p_print_cost is not null and coalesce(item.billing_price_manual, false);
  next_amount := case when preserve_manual then item.amount else round(p_amount, 2) end;
  next_unit_price := case when preserve_manual then item.unit_price else round(p_unit_price, 2) end;
  perform set_config('cijd.printing_action', 'price', true);
  update public.billing_items set
    print_cost = case when p_print_cost is null then print_cost else round(p_print_cost, 2) end,
    suggested_unit_price = case when p_print_cost is null then coalesce(suggested_unit_price, unit_price) else round(expected_amount / quantity, 2) end,
    suggested_amount = case when p_print_cost is null then coalesce(suggested_amount, amount) else round(expected_amount, 2) end,
    unit_price = next_unit_price,
    amount = next_amount,
    custom_amount = case when preserve_manual then true else false end,
    billing_price_manual = preserve_manual,
    price_source = case when p_price_source is null then price_source else nullif(btrim(p_price_source), '') end,
    price_reason = case when p_price_reason is null then price_reason else nullif(btrim(p_price_reason), '') end,
    price_review_status = case when coalesce(p_confirm, false) then 'CONFIRMED' else 'REVIEW_REQUIRED' end,
    price_confirmed_by = case when coalesce(p_confirm, false) then actor_name else null end,
    price_confirmed_at = case when coalesce(p_confirm, false) then now() else null end,
    updated_at = now(), updated_by = actor_name
  where id = p_item_id
  returning * into item;
  insert into public.audit_logs (actor, action, entity, entity_id, detail)
  values (actor_name, case when p_confirm then 'price.confirm' else 'price.edit' end,
          'billing_item', item.id, format('%s/%s', item.unit_price, item.amount));
  return item;
end;
$$;

revoke all on function public.update_print_spec(uuid, text, text, numeric, numeric, text, text) from public, anon;
grant execute on function public.update_print_spec(uuid, text, text, numeric, numeric, text, text) to authenticated, service_role;
revoke all on function public.review_print_price(uuid, numeric, numeric, numeric, boolean, text, text, text) from public, anon;
grant execute on function public.review_print_price(uuid, numeric, numeric, numeric, boolean, text, text, text) to authenticated, service_role;

-- This temporary phase intentionally lets every signed-in role use the same
-- narrow Billing-price override. Specs, delivery, status, and invoice fields
-- remain outside this operation, and invoiced/paid rows remain locked.
drop policy if exists billing_items_billing_price_update on public.billing_items;
create policy billing_items_billing_price_update on public.billing_items for update to authenticated
  using (
    current_role_name() in ('DESIGNER', 'BILLING', 'ACCOUNTING', 'PRINTING', 'ADMIN')
    and production_status in ('DELIVERED', 'COMPLETED')
    and deleted_at is null
  )
  with check (
    current_role_name() in ('DESIGNER', 'BILLING', 'ACCOUNTING', 'PRINTING', 'ADMIN')
    and production_status in ('DELIVERED', 'COMPLETED')
    and deleted_at is null
  );

create or replace function public.guard_office_billing_item_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  role_name public.user_role := public.current_role_name();
  action_name text := coalesce(current_setting('cijd.billing_action', true), '');
begin
  if action_name = 'billing_price' then
    if role_name not in ('DESIGNER', 'BILLING', 'ACCOUNTING', 'PRINTING', 'ADMIN') then
      raise exception 'FORBIDDEN';
    end if;
    if lower(btrim(old.created_by)) = 'import' then
      raise exception 'HISTORY_READ_ONLY';
    end if;
    if old.billing_status in ('INVOICED', 'PAID') then
      raise exception 'ITEM_LOCKED';
    end if;
    if new.amount is null or new.amount <= 0 then
      raise exception 'INVALID' using detail = 'Billing price must be greater than zero.';
    end if;
    if old.id is distinct from new.id
       or old.project_id is distinct from new.project_id
       or old.description is distinct from new.description
       or old.type is distinct from new.type
       or old.quantity is distinct from new.quantity
       or old.unit_price is distinct from new.unit_price
       or old.print_cost is distinct from new.print_cost
       or old.print_size is distinct from new.print_size
       or old.suggested_unit_price is distinct from new.suggested_unit_price
       or old.suggested_amount is distinct from new.suggested_amount
       or old.price_source is distinct from new.price_source
       or old.price_reason is distinct from new.price_reason
       or old.production_status is distinct from new.production_status
       or old.delivered_at is distinct from new.delivered_at
       or old.delivered_by is distinct from new.delivered_by
       or old.billing_status is distinct from new.billing_status
       or old.invoice_id is distinct from new.invoice_id
       or old.note is distinct from new.note
       or old.created_at is distinct from new.created_at
       or old.created_by is distinct from new.created_by
       or old.deleted_at is distinct from new.deleted_at then
      raise exception 'FORBIDDEN';
    end if;
    return new;
  end if;

  if role_name = 'ACCOUNTING' then
    raise exception 'FORBIDDEN';
  end if;

  if role_name = 'BILLING' then
    if old.billing_status in ('INVOICED', 'PAID') then
      raise exception 'ITEM_LOCKED';
    end if;
    if new.billing_status not in ('NOT_READY', 'READY_TO_INVOICE', 'NEEDS_REVIEW') then
      raise exception 'FORBIDDEN';
    end if;
    if old.id is distinct from new.id
       or old.project_id is distinct from new.project_id
       or old.description is distinct from new.description
       or old.type is distinct from new.type
       or old.quantity is distinct from new.quantity
       or old.unit_price is distinct from new.unit_price
       or old.amount is distinct from new.amount
       or old.custom_amount is distinct from new.custom_amount
       or old.print_cost is distinct from new.print_cost
       or old.production_status is distinct from new.production_status
       or old.delivered_at is distinct from new.delivered_at
       or old.delivered_by is distinct from new.delivered_by
       or old.invoice_id is distinct from new.invoice_id
       or old.print_size is distinct from new.print_size
       or old.price_review_status is distinct from new.price_review_status
       or old.suggested_unit_price is distinct from new.suggested_unit_price
       or old.suggested_amount is distinct from new.suggested_amount
       or old.price_source is distinct from new.price_source
       or old.price_reason is distinct from new.price_reason
       or old.price_confirmed_by is distinct from new.price_confirmed_by
       or old.price_confirmed_at is distinct from new.price_confirmed_at
       or old.note is distinct from new.note
       or old.created_at is distinct from new.created_at
       or old.created_by is distinct from new.created_by
       or old.deleted_at is distinct from new.deleted_at then
      raise exception 'FORBIDDEN';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.guard_printing_billing_item_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  role_name public.user_role := public.current_role_name();
  action_name text := coalesce(current_setting('cijd.printing_action', true), '');
  billing_action_name text := coalesce(current_setting('cijd.billing_action', true), '');
begin
  if role_name <> 'PRINTING' then
    return new;
  end if;
  if old.type <> 'PRINT'
     or new.type <> 'PRINT'
     or lower(btrim(old.created_by)) = 'import'
     or old.billing_status in ('INVOICED', 'PAID') then
    raise exception 'FORBIDDEN';
  end if;

  if billing_action_name = 'billing_price' then
    if old.id is distinct from new.id
       or old.project_id is distinct from new.project_id
       or old.description is distinct from new.description
       or old.type is distinct from new.type
       or old.quantity is distinct from new.quantity
       or old.unit_price is distinct from new.unit_price
       or old.print_cost is distinct from new.print_cost
       or old.print_size is distinct from new.print_size
       or old.suggested_unit_price is distinct from new.suggested_unit_price
       or old.suggested_amount is distinct from new.suggested_amount
       or old.price_source is distinct from new.price_source
       or old.price_reason is distinct from new.price_reason
       or old.production_status is distinct from new.production_status
       or old.delivered_at is distinct from new.delivered_at
       or old.delivered_by is distinct from new.delivered_by
       or old.billing_status is distinct from new.billing_status
       or old.invoice_id is distinct from new.invoice_id
       or old.note is distinct from new.note
       or old.created_at is distinct from new.created_at
       or old.created_by is distinct from new.created_by
       or old.deleted_at is distinct from new.deleted_at then
      raise exception 'FORBIDDEN';
    end if;
  elsif action_name = 'delivery' then
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
       or old.billing_status is distinct from new.billing_status
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
       or old.deleted_at is distinct from new.deleted_at
       or new.price_review_status is distinct from 'REVIEW_REQUIRED'
       or new.price_confirmed_by is not null
       or new.price_confirmed_at is not null then
      raise exception 'FORBIDDEN';
    end if;
  else
    raise exception 'FORBIDDEN';
  end if;
  return new;
end;
$$;

create or replace function public.override_billing_price(
  p_item_id uuid,
  p_amount numeric,
  p_actor text
) returns public.billing_items
language plpgsql security invoker set search_path = public as $$
declare
  item public.billing_items;
  actor_name text := coalesce((select name from public.users where id = auth.uid()), nullif(btrim(p_actor), ''), 'Unknown');
begin
  if current_role_name() not in ('DESIGNER', 'BILLING', 'ACCOUNTING', 'PRINTING', 'ADMIN') then
    raise exception 'FORBIDDEN';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID' using detail = 'Billing price must be greater than zero.';
  end if;
  select * into item from public.billing_items where id = p_item_id and deleted_at is null;
  if not found then raise exception 'NOT_FOUND' using detail = 'Billing item was not found.'; end if;
  if lower(btrim(item.created_by)) = 'import' then raise exception 'HISTORY_READ_ONLY'; end if;
  if item.billing_status in ('INVOICED', 'PAID') then raise exception 'ITEM_LOCKED'; end if;

  perform set_config('cijd.printing_action', 'price', true);
  perform set_config('cijd.billing_action', 'billing_price', true);
  update public.billing_items set
    amount = round(p_amount, 2),
    custom_amount = true,
    billing_price_manual = case when type = 'PRINT' then true else false end,
    suggested_unit_price = case when type = 'PRINT' then coalesce(suggested_unit_price, round(amount / quantity, 2)) else suggested_unit_price end,
    suggested_amount = case when type = 'PRINT' then coalesce(suggested_amount, amount) else suggested_amount end,
    price_review_status = case when type = 'PRINT' then 'CONFIRMED' else price_review_status end,
    price_confirmed_by = case when type = 'PRINT' then actor_name else price_confirmed_by end,
    price_confirmed_at = case when type = 'PRINT' then now() else price_confirmed_at end,
    updated_at = now(), updated_by = actor_name
  where id = p_item_id
  returning * into item;
  insert into public.audit_logs (actor, action, entity, entity_id, detail)
  values (actor_name, 'billing.price.override', 'billing_item', item.id, item.amount::text);
  return item;
end;
$$;

revoke all on function public.override_billing_price(uuid, numeric, text) from public, anon;
grant execute on function public.override_billing_price(uuid, numeric, text) to authenticated, service_role;
