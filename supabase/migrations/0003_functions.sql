-- Operations that touch more than one table run as functions, so they either
-- happen completely or not at all. They raise the same error codes the
-- application uses, and they run as the caller, so row level security still
-- applies.

create or replace function set_item_delivery(
  p_item_id uuid,
  p_delivered boolean,
  p_actor text
) returns billing_items
language plpgsql security invoker set search_path = public as $$
declare
  item billing_items;
begin
  select * into item from billing_items where id = p_item_id and deleted_at is null;
  if not found then
    raise exception 'NOT_FOUND' using detail = 'Billing item was not found.';
  end if;
  if item.billing_status in ('INVOICED', 'PAID') then
    raise exception 'ITEM_LOCKED'
      using detail = 'This item has already been invoiced, so its delivery cannot change.';
  end if;

  update billing_items set
    production_status = case when p_delivered then 'DELIVERED' else 'IN_PROGRESS' end::production_status,
    delivered_at = case when p_delivered then now() else null end,
    delivered_by = case when p_delivered then p_actor else null end,
    -- Delivering sends work to billing; undoing pulls it back out.
    billing_status = case
      when billing_status = 'NEEDS_REVIEW' then billing_status
      when p_delivered then 'READY_TO_INVOICE'::billing_status
      else 'NOT_READY'::billing_status
    end,
    updated_at = now(),
    updated_by = p_actor
  where id = p_item_id
  returning * into item;

  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, case when p_delivered then 'item.deliver' else 'item.undeliver' end,
          'billing_item', item.id, item.description);
  return item;
end;
$$;

create or replace function set_project_delivery(
  p_project_id uuid,
  p_delivered boolean,
  p_actor text
) returns setof billing_items
language plpgsql security invoker set search_path = public as $$
declare
  item billing_items;
  touched integer := 0;
begin
  if not exists (select 1 from projects where id = p_project_id and deleted_at is null) then
    raise exception 'NOT_FOUND' using detail = 'Project was not found.';
  end if;
  if not exists (select 1 from billing_items where project_id = p_project_id and deleted_at is null) then
    raise exception 'NO_ITEMS' using detail = 'Add what should be billed before marking this delivered.';
  end if;

  for item in
    select * from billing_items
    where project_id = p_project_id
      and deleted_at is null
      and billing_status not in ('INVOICED', 'PAID')
    order by created_at
  loop
    touched := touched + 1;
    return next set_item_delivery(item.id, p_delivered, p_actor);
  end loop;

  if touched = 0 then
    raise exception 'ITEM_LOCKED' using detail = 'Every item here has already been invoiced.';
  end if;

  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, case when p_delivered then 'project.deliver' else 'project.undeliver' end,
          'project', p_project_id, null);
end;
$$;

create or replace function create_invoice(
  p_client_id uuid,
  p_invoice_number text,
  p_invoice_date date,
  p_item_ids uuid[],
  p_actor text
) returns invoices
language plpgsql security invoker set search_path = public as $$
declare
  invoice invoices;
  item billing_items;
  total numeric(12, 2) := 0;
begin
  if p_invoice_number is null or btrim(p_invoice_number) = '' then
    raise exception 'INVALID' using detail = 'Invoice number is required.';
  end if;
  if p_item_ids is null or array_length(p_item_ids, 1) is null then
    raise exception 'INVALID' using detail = 'Select at least one item.';
  end if;
  if exists (
    select 1 from invoices
    where status <> 'VOID' and lower(invoice_number) = lower(btrim(p_invoice_number))
  ) then
    raise exception 'DUPLICATE_INVOICE_NUMBER'
      using detail = 'That invoice number is already in use.';
  end if;

  for item in
    select * from billing_items where id = any (p_item_ids) and deleted_at is null
  loop
    if not exists (
      select 1 from projects where id = item.project_id and client_id = p_client_id
    ) then
      raise exception 'INVALID' using detail = 'All items must belong to the same client.';
    end if;
    if item.billing_status in ('INVOICED', 'PAID') then
      raise exception 'ALREADY_INVOICED'
        using detail = format('"%s" has already been invoiced.', item.description);
    end if;
    -- The delivery gate, enforced where it cannot be skipped.
    if item.production_status <> 'DELIVERED' then
      raise exception 'NOT_DELIVERED'
        using detail = format('"%s" has not been delivered yet.', item.description);
    end if;
    if item.billing_status <> 'READY_TO_INVOICE' then
      raise exception 'NOT_READY'
        using detail = format('"%s" is not ready to invoice yet.', item.description);
    end if;
    total := total + item.amount;
  end loop;

  if total = 0 and array_length(p_item_ids, 1) > 0
     and not exists (select 1 from billing_items where id = any (p_item_ids)) then
    raise exception 'NOT_FOUND' using detail = 'Billing item was not found.';
  end if;

  insert into invoices (
    client_id, invoice_number, invoice_date, amount, status,
    receipt_status, created_by, updated_by
  )
  values (
    p_client_id, btrim(p_invoice_number), coalesce(p_invoice_date, current_date), total,
    'ISSUED', 'PENDING', p_actor, p_actor
  )
  returning * into invoice;

  insert into invoice_items (invoice_id, billing_item_id)
  select invoice.id, unnest(p_item_ids);

  update billing_items set
    billing_status = 'INVOICED',
    invoice_id = invoice.id,
    updated_at = now(),
    updated_by = p_actor
  where id = any (p_item_ids);

  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, 'invoice.create', 'invoice', invoice.id, invoice.invoice_number);
  return invoice;
end;
$$;

create or replace function void_invoice(p_invoice_id uuid, p_actor text)
returns invoices
language plpgsql security invoker set search_path = public as $$
declare
  invoice invoices;
begin
  select * into invoice from invoices where id = p_invoice_id;
  if not found then
    raise exception 'NOT_FOUND' using detail = 'Invoice was not found.';
  end if;
  if invoice.status = 'PAID' then
    raise exception 'INVOICE_PAID'
      using detail = 'This invoice is paid. Undo the payment before cancelling it.';
  end if;
  if invoice.status = 'VOID' then
    raise exception 'ALREADY_VOID' using detail = 'This invoice was already cancelled.';
  end if;

  update billing_items set
    billing_status = 'READY_TO_INVOICE',
    invoice_id = null,
    updated_at = now(),
    updated_by = p_actor
  where invoice_id = p_invoice_id;

  delete from invoice_items where invoice_id = p_invoice_id;

  update invoices set
    status = 'VOID', receipt_status = 'NOT_REQUIRED', updated_at = now(), updated_by = p_actor
  where id = p_invoice_id
  returning * into invoice;

  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, 'invoice.void', 'invoice', invoice.id, invoice.invoice_number);
  return invoice;
end;
$$;

create or replace function confirm_payment(
  p_invoice_id uuid,
  p_paid_at date,
  p_slip text,
  p_actor text
) returns invoices
language plpgsql security invoker set search_path = public as $$
declare
  invoice invoices;
begin
  select * into invoice from invoices where id = p_invoice_id;
  if not found then
    raise exception 'NOT_FOUND' using detail = 'Invoice was not found.';
  end if;
  if invoice.status = 'PAID' then
    raise exception 'ALREADY_PAID'
      using detail = format('Invoice %s was already paid on %s.', invoice.invoice_number, invoice.payment_date);
  end if;
  if invoice.status = 'VOID' then
    raise exception 'INVOICE_VOID' using detail = 'This invoice was cancelled.';
  end if;

  update invoices set
    status = 'PAID',
    payment_date = coalesce(p_paid_at, current_date),
    payment_slip = nullif(btrim(coalesce(p_slip, '')), ''),
    updated_at = now(),
    updated_by = p_actor
  where id = p_invoice_id
  returning * into invoice;

  -- The unique index on live payments is what actually stops a second payment.
  insert into payments (invoice_id, amount, paid_at, slip, created_by)
  values (invoice.id, invoice.amount, invoice.payment_date, invoice.payment_slip, p_actor);

  update billing_items set
    billing_status = 'PAID', updated_at = now(), updated_by = p_actor
  where invoice_id = p_invoice_id;

  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, 'invoice.pay', 'invoice', invoice.id, invoice.invoice_number);
  return invoice;
end;
$$;

create or replace function revert_payment(p_invoice_id uuid, p_actor text)
returns invoices
language plpgsql security invoker set search_path = public as $$
declare
  invoice invoices;
begin
  select * into invoice from invoices where id = p_invoice_id;
  if not found then
    raise exception 'NOT_FOUND' using detail = 'Invoice was not found.';
  end if;
  if invoice.status <> 'PAID' then
    raise exception 'NOT_PAID' using detail = 'This invoice is not marked as paid.';
  end if;

  update payments set voided_at = now(), voided_by = p_actor
  where invoice_id = p_invoice_id and voided_at is null;

  update billing_items set
    billing_status = 'INVOICED', updated_at = now(), updated_by = p_actor
  where invoice_id = p_invoice_id;

  update invoices set
    status = 'ISSUED', payment_date = null, payment_slip = null,
    updated_at = now(), updated_by = p_actor
  where id = p_invoice_id
  returning * into invoice;

  insert into audit_logs (actor, action, entity, entity_id, detail)
  values (p_actor, 'invoice.unpay', 'invoice', invoice.id, invoice.invoice_number);
  return invoice;
end;
$$;
