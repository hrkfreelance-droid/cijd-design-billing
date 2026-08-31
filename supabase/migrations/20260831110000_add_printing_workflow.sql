-- Printing workspace and price-review gate.
--
-- Existing rows are not backfilled. Imported rows remain historical evidence,
-- and legacy operational print rows may keep NULL metadata until their next
-- controlled write. New operational print rows are marked REVIEW_REQUIRED.

alter type public.user_role add value if not exists 'PRINTING';

do $$
begin
  if not exists (
    select 1 from pg_type where typname = 'price_review_status'
  ) then
    create type public.price_review_status as enum ('NOT_REQUIRED', 'REVIEW_REQUIRED', 'CONFIRMED');
  end if;
end
$$;

alter table public.billing_items
  add column if not exists print_size text,
  add column if not exists price_review_status public.price_review_status,
  add column if not exists suggested_unit_price numeric(12, 2),
  add column if not exists suggested_amount numeric(12, 2),
  add column if not exists price_source text,
  add column if not exists price_reason text,
  add column if not exists price_confirmed_by text,
  add column if not exists price_confirmed_at timestamptz;

create index if not exists billing_items_print_review_idx
  on public.billing_items (type, price_review_status, production_status);

-- Keep old imports and old operational rows readable without rewriting them.
alter table public.billing_items
  drop constraint if exists printing_price_review_valid;
alter table public.billing_items
  add constraint printing_price_review_valid check (
    type <> 'PRINT'
    or lower(btrim(created_by)) = 'import'
    or price_review_status is null
    or (
      price_review_status = 'REVIEW_REQUIRED'
      and price_confirmed_by is null
      and price_confirmed_at is null
    )
    or (
      price_review_status = 'CONFIRMED'
      and price_confirmed_by is not null
      and price_confirmed_at is not null
    )
  ) not valid;

alter table public.billing_items
  drop constraint if exists billing_print_requires_confirmed_price;
alter table public.billing_items
  add constraint billing_print_requires_confirmed_price check (
    billing_status <> 'READY_TO_INVOICE'
    or type <> 'PRINT'
    or lower(btrim(created_by)) = 'import'
    or price_review_status is null
    or price_review_status = 'CONFIRMED'
  ) not valid;

create or replace function public.is_printing() returns boolean
language sql stable security definer set search_path = public as $$
  select current_role_name() in ('PRINTING', 'ADMIN')
$$;

-- A Printing user gets only the project rows that contain print work and only
-- print billing rows. Invoices, payments and unrelated creative rows remain
-- outside the policy entirely.
drop policy if exists users_read on public.users;
create policy users_read on public.users for select to authenticated using (
  id = auth.uid()
  or current_role_name() in ('DESIGNER', 'BILLING', 'ACCOUNTING', 'ADMIN')
);

drop policy if exists projects_read on public.projects;
create policy projects_read on public.projects for select to authenticated using (
  is_designer()
  or (
    is_printing()
    and exists (
      select 1 from public.billing_items item
      where item.project_id = projects.id
        and item.type = 'PRINT'
        and item.deleted_at is null
    )
  )
  or (
    not is_printing()
    and exists (
      select 1 from public.billing_items item
      where item.project_id = projects.id
        and item.production_status in ('DELIVERED', 'COMPLETED')
        and item.deleted_at is null
    )
  )
);

drop policy if exists billing_items_read on public.billing_items;
create policy billing_items_read on public.billing_items for select to authenticated using (
  is_designer()
  or (is_printing() and type = 'PRINT')
  or (not is_printing() and production_status in ('DELIVERED', 'COMPLETED'))
);

drop policy if exists billing_items_printing_update on public.billing_items;
create policy billing_items_printing_update on public.billing_items for update to authenticated
  using (
    is_printing()
    and type = 'PRINT'
    and lower(btrim(created_by)) <> 'import'
    and billing_status not in ('INVOICED', 'PAID')
  )
  with check (
    is_printing()
    and type = 'PRINT'
    and lower(btrim(created_by)) <> 'import'
    and billing_status not in ('INVOICED', 'PAID')
  );

-- Direct table updates from a Printing session may not impersonate one of the
-- controlled actions. The two RPCs set a transaction-local marker; this keeps
-- RLS invoker semantics while still making column boundaries explicit.
create or replace function public.guard_printing_billing_item_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  role_name public.user_role := public.current_role_name();
  action_name text := current_setting('cijd.printing_action', true);
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

drop trigger if exists guard_printing_billing_item_update on public.billing_items;
create trigger guard_printing_billing_item_update
  before update on public.billing_items
  for each row execute function public.guard_printing_billing_item_update();

create or replace function public.ensure_print_price_review() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.type = 'PRINT' and lower(btrim(new.created_by)) <> 'import' then
    if new.price_review_status is null or new.price_review_status = 'NOT_REQUIRED' then
      new.price_review_status := 'REVIEW_REQUIRED';
    end if;
    new.suggested_unit_price := coalesce(new.suggested_unit_price, new.unit_price);
    new.suggested_amount := coalesce(new.suggested_amount, new.amount);
  end if;
  return new;
end;
$$;

drop trigger if exists ensure_print_price_review on public.billing_items;
create trigger ensure_print_price_review
  before insert on public.billing_items
  for each row execute function public.ensure_print_price_review();

create or replace function public.maintain_print_price_review() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.type = 'PRINT'
     and lower(btrim(new.created_by)) <> 'import'
     and coalesce(current_setting('cijd.printing_action', true), '') not in ('price', 'spec')
     and (
       old.type is distinct from new.type
       or old.quantity is distinct from new.quantity
       or old.unit_price is distinct from new.unit_price
       or old.amount is distinct from new.amount
       or old.print_size is distinct from new.print_size
     ) then
    new.price_review_status := 'REVIEW_REQUIRED';
    new.suggested_unit_price := new.unit_price;
    new.suggested_amount := new.amount;
    new.price_confirmed_by := null;
    new.price_confirmed_at := null;
    if new.billing_status = 'READY_TO_INVOICE' then
      new.billing_status := 'NEEDS_REVIEW';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists maintain_print_price_review on public.billing_items;
create trigger maintain_print_price_review
  before update on public.billing_items
  for each row execute function public.maintain_print_price_review();

create or replace function public.set_item_delivery(
  p_item_id uuid,
  p_delivered boolean,
  p_actor text
) returns public.billing_items
language plpgsql security invoker set search_path = public as $$
declare
  item public.billing_items;
  actor_name text := coalesce((select name from public.users where id = auth.uid()), nullif(btrim(p_actor), ''), 'Unknown');
begin
  select * into item from public.billing_items where id = p_item_id and deleted_at is null;
  if not found then
    raise exception 'NOT_FOUND' using detail = 'Billing item was not found.';
  end if;
  if lower(btrim(item.created_by)) = 'import' then
    raise exception 'HISTORY_READ_ONLY' using detail = 'Imported history is read-only.';
  end if;
  if item.type <> 'PRINT' then
    raise exception 'WRONG_PRODUCTION_ACTION'
      using detail = 'Creative work must be marked complete, not delivered.';
  end if;
  if item.billing_status in ('INVOICED', 'PAID') then
    raise exception 'ITEM_LOCKED'
      using detail = 'This item has already been invoiced, so its delivery cannot change.';
  end if;

  perform set_config('cijd.printing_action', 'delivery', true);
  update public.billing_items set
    production_status = case when p_delivered then 'DELIVERED' else 'IN_PROGRESS' end::public.production_status,
    delivered_at = case when p_delivered then now() else null end,
    delivered_by = case when p_delivered then actor_name else null end,
    billing_status = case
      when p_delivered and coalesce(item.price_review_status, 'REVIEW_REQUIRED') <> 'CONFIRMED'::public.price_review_status then 'NEEDS_REVIEW'::public.billing_status
      when p_delivered then 'READY_TO_INVOICE'::public.billing_status
      else 'NOT_READY'::public.billing_status
    end,
    updated_at = now(),
    updated_by = actor_name
  where id = p_item_id
  returning * into item;

  insert into public.audit_logs (actor, action, entity, entity_id, detail)
  values (actor_name, case when p_delivered then 'item.deliver' else 'item.undeliver' end,
          'billing_item', item.id, item.description);
  return item;
end;
$$;

create or replace function public.set_project_delivery(
  p_project_id uuid,
  p_delivered boolean,
  p_actor text
) returns setof public.billing_items
language plpgsql security invoker set search_path = public as $$
declare
  item public.billing_items;
  touched integer := 0;
begin
  if current_role_name() = 'PRINTING' then
    raise exception 'FORBIDDEN' using detail = 'Printing work is handled one item at a time.';
  end if;
  if not exists (select 1 from public.projects where id = p_project_id and deleted_at is null) then
    raise exception 'NOT_FOUND' using detail = 'Project was not found.';
  end if;
  if not exists (select 1 from public.billing_items where project_id = p_project_id and deleted_at is null) then
    raise exception 'NO_ITEMS' using detail = 'Add what should be billed before marking this complete.';
  end if;

  for item in
    select * from public.billing_items
    where project_id = p_project_id and deleted_at is null
      and billing_status not in ('INVOICED', 'PAID')
    order by created_at
  loop
    touched := touched + 1;
    update public.billing_items set
      production_status = case when p_delivered then
        case when item.type = 'PRINT' then 'DELIVERED' else 'COMPLETED' end::public.production_status
        else 'IN_PROGRESS'::public.production_status end,
      delivered_at = case when p_delivered then now() else null end,
      delivered_by = case when p_delivered then p_actor else null end,
      billing_status = case
        when item.type = 'PRINT' and p_delivered and coalesce(item.price_review_status, 'REVIEW_REQUIRED') <> 'CONFIRMED'::public.price_review_status then 'NEEDS_REVIEW'::public.billing_status
        when item.billing_status = 'NEEDS_REVIEW' then item.billing_status
        when p_delivered then 'READY_TO_INVOICE'::public.billing_status
        else 'NOT_READY'::public.billing_status
      end,
      updated_at = now(), updated_by = p_actor
    where id = item.id
    returning * into item;
    insert into public.audit_logs (actor, action, entity, entity_id, detail)
    values (
      p_actor,
      case when p_delivered and item.type = 'PRINT' then 'item.deliver'
           when p_delivered then 'item.complete'
           when item.type = 'PRINT' then 'item.undeliver'
           else 'item.uncomplete' end,
      'billing_item', item.id, item.description
    );
    return next item;
  end loop;
  if touched = 0 then
    raise exception 'ITEM_LOCKED' using detail = 'Every item here has already been invoiced.';
  end if;
  insert into public.audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, case when p_delivered then 'project.deliver' else 'project.undeliver' end,
          'project', p_project_id, null);
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
language plpgsql security invoker set search_path = public as $$
declare
  item public.billing_items;
  actor_name text := coalesce((select name from public.users where id = auth.uid()), nullif(btrim(p_actor), ''), 'Unknown');
  next_description text;
  next_size text;
  next_note text;
  next_quantity numeric;
  next_amount numeric;
begin
  if current_role_name() not in ('PRINTING', 'ADMIN') then raise exception 'FORBIDDEN'; end if;
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
  next_amount := round(next_quantity * item.unit_price, 2);

  perform set_config('cijd.printing_action', 'spec', true);
  update public.billing_items set
    description = next_description,
    print_size = next_size,
    quantity = next_quantity,
    note = next_note,
    amount = next_amount,
    price_review_status = 'REVIEW_REQUIRED',
    suggested_unit_price = unit_price,
    suggested_amount = next_amount,
    price_confirmed_by = null,
    price_confirmed_at = null,
    billing_status = case when billing_status = 'READY_TO_INVOICE' then 'NEEDS_REVIEW'::public.billing_status else billing_status end,
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
  p_confirm boolean,
  p_price_source text,
  p_price_reason text,
  p_actor text
) returns public.billing_items
language plpgsql security invoker set search_path = public as $$
declare
  item public.billing_items;
  actor_name text := coalesce((select name from public.users where id = auth.uid()), nullif(btrim(p_actor), ''), 'Unknown');
begin
  if current_role_name() not in ('PRINTING', 'ADMIN') then raise exception 'FORBIDDEN'; end if;
  select * into item from public.billing_items where id = p_item_id and deleted_at is null;
  if not found then raise exception 'NOT_FOUND' using detail = 'Billing item was not found.'; end if;
  if item.type <> 'PRINT' then raise exception 'INVALID_PRINT'; end if;
  if lower(btrim(item.created_by)) = 'import' then raise exception 'HISTORY_READ_ONLY'; end if;
  if item.billing_status in ('INVOICED', 'PAID') then raise exception 'ITEM_LOCKED'; end if;
  if p_unit_price is null or p_unit_price <= 0 or p_amount is null or p_amount <= 0 then
    raise exception 'INVALID' using detail = 'A confirmed print price must be greater than zero.';
  end if;

  perform set_config('cijd.printing_action', 'price', true);
  update public.billing_items set
    suggested_unit_price = coalesce(suggested_unit_price, unit_price),
    suggested_amount = coalesce(suggested_amount, amount),
    unit_price = round(p_unit_price, 2),
    amount = round(p_amount, 2),
    custom_amount = round(p_amount, 2) <> round(quantity * p_unit_price, 2),
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

-- Existing imported invoices remain valid. New operational print invoices need
-- both production completion and a confirmed human price.
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
  total numeric(12, 2) := 0;
  requested_count integer;
  found_count integer;
begin
  if p_invoice_number is null or btrim(p_invoice_number) = '' then raise exception 'INVALID' using detail = 'Invoice number is required.'; end if;
  if p_item_ids is null or array_length(p_item_ids, 1) is null then raise exception 'INVALID' using detail = 'Select at least one item.'; end if;
  select count(*) into requested_count from unnest(p_item_ids) as requested(id);
  select count(*) into found_count
    from public.billing_items
    where id = any (p_item_ids) and deleted_at is null;
  if found_count <> requested_count then
    raise exception 'NOT_FOUND' using detail = 'One or more billing items were not found.';
  end if;
  if exists (select 1 from public.invoices where status <> 'VOID' and lower(invoice_number) = lower(btrim(p_invoice_number))) then
    raise exception 'DUPLICATE_INVOICE_NUMBER' using detail = 'That invoice number is already in use.';
  end if;
  for item in select * from public.billing_items where id = any (p_item_ids) and deleted_at is null loop
    if not exists (select 1 from public.projects where id = item.project_id and client_id = p_client_id) then raise exception 'INVALID' using detail = 'All items must belong to the same client.'; end if;
    if item.billing_status in ('INVOICED', 'PAID') then raise exception 'ALREADY_INVOICED'; end if;
    if item.production_status not in ('DELIVERED', 'COMPLETED') then raise exception 'NOT_DELIVERED' using detail = format('"%s" has not completed production yet.', item.description); end if;
    if item.type = 'PRINT' and lower(btrim(item.created_by)) <> 'import'
       and coalesce(item.price_review_status, 'REVIEW_REQUIRED') <> 'CONFIRMED'::public.price_review_status then
      raise exception 'PRICE_REVIEW_REQUIRED' using detail = format('"%s" needs a confirmed print price first.', item.description);
    end if;
    if item.billing_status <> 'READY_TO_INVOICE' then raise exception 'NOT_READY' using detail = format('"%s" is not ready to invoice yet.', item.description); end if;
    total := total + item.amount;
  end loop;
  insert into public.invoices (client_id, invoice_number, invoice_date, amount, status, receipt_status, created_by, updated_by)
  values (p_client_id, btrim(p_invoice_number), coalesce(p_invoice_date, current_date), total, 'ISSUED', 'PENDING', p_actor, p_actor)
  returning * into invoice;
  insert into public.invoice_items (invoice_id, billing_item_id) select invoice.id, unnest(p_item_ids);
  update public.billing_items set billing_status = 'INVOICED', invoice_id = invoice.id, updated_at = now(), updated_by = p_actor where id = any (p_item_ids);
  insert into public.audit_logs (actor, action, entity, entity_id, detail) values (p_actor, 'invoice.create', 'invoice', invoice.id, invoice.invoice_number);
  return invoice;
end;
$$;

revoke all on function public.is_printing() from public, anon;
grant execute on function public.is_printing() to authenticated, service_role;
revoke all on function public.update_print_spec(uuid, text, text, numeric, text, text) from public, anon;
grant execute on function public.update_print_spec(uuid, text, text, numeric, text, text) to authenticated, service_role;
revoke all on function public.review_print_price(uuid, numeric, numeric, boolean, text, text, text) from public, anon;
grant execute on function public.review_print_price(uuid, numeric, numeric, boolean, text, text, text) to authenticated, service_role;
revoke all on function public.guard_printing_billing_item_update() from public, anon, authenticated, service_role;
revoke all on function public.ensure_print_price_review() from public, anon, authenticated, service_role;
revoke all on function public.maintain_print_price_review() from public, anon, authenticated, service_role;
