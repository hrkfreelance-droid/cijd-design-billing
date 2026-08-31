-- Creative completion is a production terminal state, alongside physical
-- delivery. Existing rows are not backfilled: this migration only expands the
-- rules used by future writes and keeps all imported facts as they are.

alter type public.production_status add value if not exists 'COMPLETED';

alter table public.billing_items
  drop constraint if exists billing_needs_delivery;

alter table public.billing_items
  add constraint billing_needs_production_completion check (
    billing_status in ('NOT_READY', 'NEEDS_REVIEW')
    or production_status in ('DELIVERED', 'COMPLETED')
  );

alter table public.billing_items
  drop constraint if exists delivery_is_stamped;

alter table public.billing_items
  add constraint production_completion_is_stamped check (
    (production_status in ('DELIVERED', 'COMPLETED')) = (delivered_at is not null)
  );

-- Office can read only work whose production is complete, regardless of the
-- physical/creative wording used by the designer.
drop policy if exists projects_read on public.projects;
create policy projects_read on public.projects for select to authenticated using (
  is_designer()
  or exists (
    select 1 from public.billing_items item
    where item.project_id = projects.id
      and item.production_status in ('DELIVERED', 'COMPLETED')
      and item.deleted_at is null
  )
);

drop policy if exists billing_items_read on public.billing_items;
create policy billing_items_read on public.billing_items for select to authenticated using (
  is_designer() or production_status in ('DELIVERED', 'COMPLETED')
);

drop policy if exists billing_items_office_update on public.billing_items;
create policy billing_items_office_update on public.billing_items for update to authenticated
  using (can_invoice() and production_status in ('DELIVERED', 'COMPLETED'))
  with check (can_invoice() and production_status in ('DELIVERED', 'COMPLETED'));

drop policy if exists billing_items_payment_update on public.billing_items;
create policy billing_items_payment_update on public.billing_items for update to authenticated
  using (can_take_payment() and production_status in ('DELIVERED', 'COMPLETED'))
  with check (can_take_payment() and production_status in ('DELIVERED', 'COMPLETED'));

-- The item endpoint is intentionally type-specific. Project-level Telegram
-- handoff below is the only bulk operation and maps each item by type.
create or replace function public.set_item_delivery(
  p_item_id uuid,
  p_delivered boolean,
  p_actor text
) returns public.billing_items
language plpgsql security invoker set search_path = public as $$
declare
  item public.billing_items;
begin
  select * into item
  from public.billing_items
  where id = p_item_id and deleted_at is null;
  if not found then
    raise exception 'NOT_FOUND' using detail = 'Billing item was not found.';
  end if;
  if item.type <> 'PRINT' then
    raise exception 'WRONG_PRODUCTION_ACTION'
      using detail = 'Creative work must be marked complete, not delivered.';
  end if;
  if item.billing_status in ('INVOICED', 'PAID') then
    raise exception 'ITEM_LOCKED'
      using detail = 'This item has already been invoiced, so its production status cannot change.';
  end if;

  update public.billing_items set
    production_status = case when p_delivered then 'DELIVERED' else 'IN_PROGRESS' end::public.production_status,
    delivered_at = case when p_delivered then now() else null end,
    delivered_by = case when p_delivered then p_actor else null end,
    billing_status = case
      when billing_status = 'NEEDS_REVIEW' then billing_status
      when p_delivered then 'READY_TO_INVOICE'::public.billing_status
      else 'NOT_READY'::public.billing_status
    end,
    updated_at = now(),
    updated_by = p_actor
  where id = p_item_id
  returning * into item;

  insert into public.audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, case when p_delivered then 'item.deliver' else 'item.undeliver' end,
          'billing_item', item.id, item.description);
  return item;
end;
$$;

create or replace function public.set_item_completion(
  p_item_id uuid,
  p_completed boolean,
  p_actor text
) returns public.billing_items
language plpgsql security invoker set search_path = public as $$
declare
  item public.billing_items;
begin
  select * into item
  from public.billing_items
  where id = p_item_id and deleted_at is null;
  if not found then
    raise exception 'NOT_FOUND' using detail = 'Billing item was not found.';
  end if;
  if item.type = 'PRINT' then
    raise exception 'WRONG_PRODUCTION_ACTION'
      using detail = 'Print items must be marked delivered, not completed.';
  end if;
  if item.billing_status in ('INVOICED', 'PAID') then
    raise exception 'ITEM_LOCKED'
      using detail = 'This item has already been invoiced, so its production status cannot change.';
  end if;

  update public.billing_items set
    production_status = case when p_completed then 'COMPLETED' else 'IN_PROGRESS' end::public.production_status,
    delivered_at = case when p_completed then now() else null end,
    delivered_by = case when p_completed then p_actor else null end,
    billing_status = case
      when billing_status = 'NEEDS_REVIEW' then billing_status
      when p_completed then 'READY_TO_INVOICE'::public.billing_status
      else 'NOT_READY'::public.billing_status
    end,
    updated_at = now(),
    updated_by = p_actor
  where id = p_item_id
  returning * into item;

  insert into public.audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, case when p_completed then 'item.complete' else 'item.uncomplete' end,
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
  if not exists (
    select 1 from public.projects where id = p_project_id and deleted_at is null
  ) then
    raise exception 'NOT_FOUND' using detail = 'Project was not found.';
  end if;
  if not exists (
    select 1 from public.billing_items where project_id = p_project_id and deleted_at is null
  ) then
    raise exception 'NO_ITEMS' using detail = 'Add what should be billed before marking this complete.';
  end if;

  for item in
    select * from public.billing_items
    where project_id = p_project_id
      and deleted_at is null
      and billing_status not in ('INVOICED', 'PAID')
    order by created_at
  loop
    touched := touched + 1;
    update public.billing_items set
      production_status = case
        when p_delivered then
          case when item.type = 'PRINT' then 'DELIVERED' else 'COMPLETED' end::public.production_status
        else 'IN_PROGRESS'::public.production_status
      end,
      delivered_at = case when p_delivered then now() else null end,
      delivered_by = case when p_delivered then p_actor else null end,
      billing_status = case
        when billing_status = 'NEEDS_REVIEW' then billing_status
        when p_delivered then 'READY_TO_INVOICE'::public.billing_status
        else 'NOT_READY'::public.billing_status
      end,
      updated_at = now(),
      updated_by = p_actor
    where id = item.id
    returning * into item;

    insert into public.audit_logs (actor, action, entity, entity_id, detail)
    values (
      p_actor,
      case
        when p_delivered and item.type = 'PRINT' then 'item.deliver'
        when p_delivered then 'item.complete'
        when item.type = 'PRINT' then 'item.undeliver'
        else 'item.uncomplete'
      end,
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
begin
  if p_invoice_number is null or btrim(p_invoice_number) = '' then
    raise exception 'INVALID' using detail = 'Invoice number is required.';
  end if;
  if p_item_ids is null or array_length(p_item_ids, 1) is null then
    raise exception 'INVALID' using detail = 'Select at least one item.';
  end if;
  if exists (
    select 1 from public.invoices
    where status <> 'VOID' and lower(invoice_number) = lower(btrim(p_invoice_number))
  ) then
    raise exception 'DUPLICATE_INVOICE_NUMBER'
      using detail = 'That invoice number is already in use.';
  end if;

  for item in
    select * from public.billing_items where id = any (p_item_ids) and deleted_at is null
  loop
    if not exists (
      select 1 from public.projects where id = item.project_id and client_id = p_client_id
    ) then
      raise exception 'INVALID' using detail = 'All items must belong to the same client.';
    end if;
    if item.billing_status in ('INVOICED', 'PAID') then
      raise exception 'ALREADY_INVOICED'
        using detail = format('"%s" has already been invoiced.', item.description);
    end if;
    if item.production_status not in ('DELIVERED', 'COMPLETED') then
      raise exception 'NOT_DELIVERED'
        using detail = format('"%s" has not completed production yet.', item.description);
    end if;
    if item.billing_status <> 'READY_TO_INVOICE' then
      raise exception 'NOT_READY'
        using detail = format('"%s" is not ready to invoice yet.', item.description);
    end if;
    total := total + item.amount;
  end loop;

  if total = 0 and array_length(p_item_ids, 1) > 0
     and not exists (select 1 from public.billing_items where id = any (p_item_ids)) then
    raise exception 'NOT_FOUND' using detail = 'Billing item was not found.';
  end if;

  insert into public.invoices (
    client_id, invoice_number, invoice_date, amount, status,
    receipt_status, created_by, updated_by
  )
  values (
    p_client_id, btrim(p_invoice_number), coalesce(p_invoice_date, current_date), total,
    'ISSUED', 'PENDING', p_actor, p_actor
  )
  returning * into invoice;

  insert into public.invoice_items (invoice_id, billing_item_id)
  select invoice.id, unnest(p_item_ids);

  update public.billing_items set
    billing_status = 'INVOICED',
    invoice_id = invoice.id,
    updated_at = now(),
    updated_by = p_actor
  where id = any (p_item_ids);

  insert into public.audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, 'invoice.create', 'invoice', invoice.id, invoice.invoice_number);
  return invoice;
end;
$$;

revoke execute on function public.set_item_completion(uuid, boolean, text) from public;
grant execute on function public.set_item_completion(uuid, boolean, text)
  to authenticated, service_role;
