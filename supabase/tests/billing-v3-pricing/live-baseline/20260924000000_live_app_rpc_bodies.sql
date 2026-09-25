-- HARNESS BASELINE ONLY — not a migration.
--
-- The live 7-arg update_print_spec and 8-arg review_print_price differ from
-- this repository's copies (live md5(prosrc): bbbf6b4ac9c725e774a54c8e9db2d4a5
-- and 7aba03d0e45011bfb47f419714d23e93). Their full text is not available in
-- any repository, so this is a RECONSTRUCTION: the repository body with the
-- live authorization quoted from production —
--   update_print_spec:  if current_role_name() not in ('DESIGNER', 'PRINTING', 'ADMIN')
--   review_print_price: if current_role_name() not in ('PRINTING', 'ADMIN')
-- — and no service-role branch. It is not byte-identical to live (its hashes
-- differ), which is why run.sh tests 20260925100000 twice: as committed (its
-- preflight must refuse these non-live bodies) and with only those two
-- expected hashes swapped for this reconstruction's, to exercise the
-- live-derived replacement end to end.

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
  if current_role_name() not in ('DESIGNER', 'PRINTING', 'ADMIN') then
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
  if current_role_name() not in ('PRINTING', 'ADMIN') then
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
