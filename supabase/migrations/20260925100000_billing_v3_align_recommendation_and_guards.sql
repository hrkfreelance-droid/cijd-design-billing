-- CIJD Billing V3: align the ACTIVE recommendation paths with the markup
-- rule, and close direct writes to the new and Sep 12 pricing columns.
--
-- Follow-up to 20260925090000 (must run after it). Written against the live
-- schema: repository chain + 20260902* (print_cost_billing_pricing, …) +
-- 20260912* (add_print_margin_override, print_margin_rpc, print_cost_basis_rpc).
--
--   Recommended = round(Cost Total × (1 + markup), 2)
--   markup = the line's markup_override (percent) when set, else
--            <= $50 → +50%   <= $100 → +40%   otherwise → +30%
--   No gross-margin formula, no $5 rounding.
--
-- REPLACED (the exact live bodies, each checked by hash before it is replaced;
-- any other body aborts the whole migration and changes nothing):
--   ensure_print_price_review()         BEFORE INSERT trigger — formula only
--   update_print_spec(7 args, p_print_cost)          called by the app — formula only
--   review_print_price(8 args, p_print_cost)         called by the app — formula only,
--        plus the enum cast that made it fail at runtime (the same fix
--        20260902100000 applied to the 7-arg overload)
--   guard_office_billing_item_update()  — see GUARDS
--   guard_printing_billing_item_update() — see GUARDS
--   override_billing_unit_price, set_billing_item_markup (from 20260925090000)
--        — announce themselves to the guards instead of borrowing actions
--
-- UNTOUCHED (compatibility; established parameter semantics are kept):
--   update_print_spec(6 args), review_print_price(7 args), set_billing_price,
--   round_print_billing_price, update_print_spec_with_margin,
--   review_print_price_with_margin (gross margin via margin_override),
--   update_print_spec_with_costs (print-cost basis), maintain_print_price_review,
--   override_billing_price, and the margin_override column.
--
-- GUARDS: bodies unchanged except
--   * set_billing_item_markup announces cijd.billing_markup; only
--     markup_override (and updated_*) may change under it — the ONLY way to
--     change markup_override for BILLING, ACCOUNTING and PRINTING;
--   * inside a billing-price override, unit_price may change only when
--     override_billing_unit_price announces cijd.billing_unit_price;
--   * a direct BILLING update may change billing_status, billing_override and
--     updated_* only — every other column (incl. print_cost_unit_price,
--     print_cost_amount, print_cost_confirmed_*, billing_price_manual,
--     service_type, margin_override, markup_override) is refused;
--   * imported-history and invoiced/paid locks are unchanged.
--
-- No row is updated, deleted or backfilled. One transaction.

begin;

-- 0. Preflight: replace only the exact bodies this was written against ------

do $$
declare
  r record;
  actual text;
  mismatched text[] := array[]::text[];
begin
  if to_regprocedure('public.print_markup_recommended_amount(numeric,numeric)') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public'
                    and table_name = 'billing_items' and column_name = 'markup_override') then
    raise exception 'PREFLIGHT: apply 20260925090000 first';
  end if;
  for r in select * from (values
    ('public.ensure_print_price_review()', 'a92956468b75b1bb2e87652dfe28eaf8'),
    ('public.update_print_spec(uuid,text,text,numeric,numeric,text,text)', '77cef03f754f1fa50a23164c90080f8f'),
    ('public.review_print_price(uuid,numeric,numeric,numeric,boolean,text,text,text)', '52a1ed7e4a7f94f6be559dc3a02a73c2'),
    ('public.guard_office_billing_item_update()', '3e61115d792b25b6ac3fae259a96c4c3'),
    ('public.guard_printing_billing_item_update()', '5f9eea98caf5587be12aaf3e61d95dbb'),
    ('public.override_billing_unit_price(uuid,numeric,numeric,text)', '281dc6b30d39d5f3b440d2126d21d4b9'),
    ('public.set_billing_item_markup(uuid,numeric,text)', 'f91254314ab1fc2d54bf3f4eb8cca941')
  ) v(signature, body_md5) loop
    select md5(p.prosrc) into actual from pg_proc p where p.oid = to_regprocedure(r.signature);
    if actual is distinct from r.body_md5 then
      mismatched := mismatched || format('%s (live %s)', r.signature, coalesce(actual, 'missing'));
    end if;
  end loop;
  if array_length(mismatched, 1) > 0 then
    raise exception 'PREFLIGHT: live definitions differ from the expected ones, nothing was changed: %', mismatched;
  end if;
end $$;

-- 1. Active recommendation paths --------------------------------------------

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
      suggested := public.print_markup_recommended_amount(new.print_cost, new.markup_override);
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
    when next_cost is not null then public.print_markup_recommended_amount(next_cost, item.markup_override)
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
    when p_print_cost is not null then public.print_markup_recommended_amount(p_print_cost, item.markup_override)
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
    price_review_status = (case when coalesce(p_confirm, false) then 'CONFIRMED' else 'REVIEW_REQUIRED' end)::public.price_review_status,
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

-- 2. Guards ----------------------------------------------------------------

create or replace function public.guard_office_billing_item_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  role_name public.user_role := public.current_role_name();
  action_name text := coalesce(current_setting('cijd.billing_action', true), '');
  unit_price_write boolean := coalesce(current_setting('cijd.billing_unit_price', true), '') = 'on';
  markup_write boolean := coalesce(current_setting('cijd.billing_markup', true), '') = 'on';
begin
  -- set_billing_item_markup: the line's markup and nothing else.
  if markup_write then
    if role_name not in ('DESIGNER', 'BILLING', 'ACCOUNTING', 'PRINTING', 'ADMIN') then
      raise exception 'FORBIDDEN';
    end if;
    if lower(btrim(old.created_by)) = 'import' then raise exception 'HISTORY_READ_ONLY'; end if;
    if old.billing_status in ('INVOICED', 'PAID') then raise exception 'ITEM_LOCKED'; end if;
    if (to_jsonb(new) - 'markup_override' - 'updated_at' - 'updated_by')
       is distinct from (to_jsonb(old) - 'markup_override' - 'updated_at' - 'updated_by') then
      raise exception 'FORBIDDEN';
    end if;
    return new;
  end if;

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
       or (old.unit_price is distinct from new.unit_price and not unit_price_write)
       or old.markup_override is distinct from new.markup_override
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
    -- Billing moves an item through billing and nothing else. Every other
    -- column — including the print-cost basis, margin_override and
    -- markup_override, and any column added later — is refused.
    if (to_jsonb(new) - 'billing_status' - 'billing_override' - 'updated_at' - 'updated_by')
       is distinct from (to_jsonb(old) - 'billing_status' - 'billing_override' - 'updated_at' - 'updated_by') then
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
  unit_price_write boolean := coalesce(current_setting('cijd.billing_unit_price', true), '') = 'on';
  markup_write boolean := coalesce(current_setting('cijd.billing_markup', true), '') = 'on';
begin
  if role_name is distinct from 'PRINTING' then
    return new;
  end if;
  if old.type <> 'PRINT'
     or new.type <> 'PRINT'
     or lower(btrim(old.created_by)) = 'import'
     or old.billing_status in ('INVOICED', 'PAID') then
    raise exception 'FORBIDDEN';
  end if;

  -- markup_override moves only through set_billing_item_markup.
  if markup_write then
    if (to_jsonb(new) - 'markup_override' - 'updated_at' - 'updated_by')
       is distinct from (to_jsonb(old) - 'markup_override' - 'updated_at' - 'updated_by') then
      raise exception 'FORBIDDEN';
    end if;
    return new;
  end if;
  if old.markup_override is distinct from new.markup_override then
    raise exception 'FORBIDDEN';
  end if;

  if billing_action_name = 'billing_price' then
    if old.id is distinct from new.id
       or old.project_id is distinct from new.project_id
       or old.description is distinct from new.description
       or old.type is distinct from new.type
       or old.quantity is distinct from new.quantity
       or (old.unit_price is distinct from new.unit_price and not unit_price_write)
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

-- 3. The new RPCs announce themselves ------------------------------------------

create or replace function public.override_billing_unit_price(
  p_item_id uuid,
  p_unit_price numeric,
  p_amount numeric,
  p_actor text
) returns public.billing_items
language plpgsql security invoker set search_path = public as $$
declare
  item public.billing_items;
  actor_name text := coalesce((select name from public.users where id = auth.uid()), nullif(btrim(p_actor), ''), 'Unknown');
begin
  -- A trusted server session (service key) has no application role; nested so
  -- current_role_name() is never evaluated for it.
  if coalesce(auth.role(), '') <> 'service_role' then
    if current_role_name() is null
       or current_role_name() not in ('DESIGNER', 'BILLING', 'ACCOUNTING', 'PRINTING', 'ADMIN') then
      raise exception 'FORBIDDEN';
    end if;
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID' using detail = 'Billing price must be greater than zero.';
  end if;
  if p_unit_price is null or p_unit_price < 0 then
    raise exception 'INVALID' using detail = 'Unit price must be zero or more.';
  end if;
  select * into item from public.billing_items where id = p_item_id and deleted_at is null;
  if not found then raise exception 'NOT_FOUND' using detail = 'Billing item was not found.'; end if;
  if lower(btrim(item.created_by)) = 'import' then raise exception 'HISTORY_READ_ONLY'; end if;
  if item.billing_status in ('INVOICED', 'PAID') then raise exception 'ITEM_LOCKED'; end if;
  if item.quantity is null or item.quantity <= 0 then
    raise exception 'INVALID' using detail = 'Quantity must be greater than zero.';
  end if;
  if round(p_amount, 2) <> round(item.quantity * round(p_unit_price, 2), 2)
     and round(p_unit_price, 2) <> round(round(p_amount, 2) / item.quantity, 2) then
    raise exception 'INVALID' using detail = 'Unit price and total do not match the quantity.';
  end if;

  perform set_config('cijd.printing_action', 'price', true);
  perform set_config('cijd.billing_action', 'billing_price', true);
  perform set_config('cijd.billing_unit_price', 'on', true);
  update public.billing_items set
    amount = round(p_amount, 2),
    unit_price = round(p_unit_price, 2),
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
  -- Row security can hide the row from this role; say so rather than return nothing.
  if not found then raise exception 'FORBIDDEN'; end if;
  perform set_config('cijd.printing_action', '', true);
  perform set_config('cijd.billing_action', '', true);
  perform set_config('cijd.billing_unit_price', '', true);
  insert into public.audit_logs (actor, action, entity, entity_id, detail)
  values (actor_name, 'billing.price.override', 'billing_item', item.id, format('%s/%s', item.unit_price, item.amount));
  return item;
end;
$$;

create or replace function public.set_billing_item_markup(
  p_item_id uuid,
  p_markup_percent numeric,
  p_actor text
) returns public.billing_items
language plpgsql security invoker set search_path = public as $$
declare
  item public.billing_items;
  actor_name text := coalesce((select name from public.users where id = auth.uid()), nullif(btrim(p_actor), ''), 'Unknown');
  role_name public.user_role;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    role_name := current_role_name();
    if role_name is null or role_name not in ('DESIGNER', 'BILLING', 'ACCOUNTING', 'PRINTING', 'ADMIN') then
      raise exception 'FORBIDDEN';
    end if;
  end if;
  if p_markup_percent is not null and (p_markup_percent < 0 or p_markup_percent > 1000) then
    raise exception 'INVALID' using detail = 'Markup must be between 0% and 1000%.';
  end if;
  select * into item from public.billing_items where id = p_item_id and deleted_at is null;
  if not found then raise exception 'NOT_FOUND' using detail = 'Billing item was not found.'; end if;
  if lower(btrim(item.created_by)) = 'import' then raise exception 'HISTORY_READ_ONLY'; end if;
  if item.billing_status in ('INVOICED', 'PAID') then raise exception 'ITEM_LOCKED'; end if;

  perform set_config('cijd.billing_markup', 'on', true);
  update public.billing_items set
    markup_override = case when p_markup_percent is null then null else round(p_markup_percent, 2) end,
    updated_at = now(), updated_by = actor_name
  where id = p_item_id
  returning * into item;
  if not found then raise exception 'FORBIDDEN'; end if;
  perform set_config('cijd.billing_markup', '', true);
  insert into public.audit_logs (actor, action, entity, entity_id, detail)
  values (actor_name, 'billing.markup', 'billing_item', item.id, coalesce(item.markup_override::text, 'default'));
  return item;
end;
$$;

commit;
