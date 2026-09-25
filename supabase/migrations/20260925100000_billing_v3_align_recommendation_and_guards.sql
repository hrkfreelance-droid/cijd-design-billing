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
--        These two are derived from their LIVE bodies inside this transaction
--        (see 1b): their authorization and everything else stay exactly as
--        live, e.g. update_print_spec keeps
--        `if current_role_name() not in ('DESIGNER', 'PRINTING', 'ADMIN')` and
--        review_print_price keeps `... not in ('PRINTING', 'ADMIN')`.
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
    ('public.update_print_spec(uuid,text,text,numeric,numeric,text,text)', 'bbbf6b4ac9c725e774a54c8e9db2d4a5'),
    ('public.review_print_price(uuid,numeric,numeric,numeric,boolean,text,text,text)', '7aba03d0e45011bfb47f419714d23e93'),
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



-- 1b. The two app-called RPCs: derived from their LIVE bodies -----------------
-- These live bodies differ from this repository's copies (their own
-- authorization, e.g. `current_role_name() not in ('DESIGNER', 'PRINTING',
-- 'ADMIN')` with no service-role branch). So they are not rewritten from a
-- copy: each live definition is read inside this transaction (its hash was
-- verified above), exactly the intended substrings are replaced — each must
-- occur exactly once — and the result is executed. Afterwards the new body
-- must equal the old body with exactly those replacements, and every other
-- attribute (arguments, return type, language, security, volatility,
-- search_path, grants) must be unchanged. Anything else aborts the migration.

create function pg_temp.align_live_function(
  p_signature text,
  p_replacements text[][]   -- {{old, new}, ...}; each old must occur exactly once
) returns void language plpgsql as $align$
declare
  fn oid := to_regprocedure(p_signature);
  before_src text;
  before_def text;
  before_attrs text;
  expected_src text;
  new_def text;
  old_text text;
  new_text text;
  occurrences int;
  i int;
begin
  if fn is null then raise exception 'ALIGN: % is missing', p_signature; end if;
  select prosrc, pg_get_functiondef(oid),
         concat_ws('|', proargtypes::text, prorettype::text, prolang::text, prosecdef::text,
                   provolatile::text, coalesce(proconfig::text, ''), coalesce(proacl::text, ''), proowner::text)
    into before_src, before_def, before_attrs
    from pg_proc where oid = fn;
  expected_src := before_src;
  new_def := before_def;
  for i in 1 .. array_length(p_replacements, 1) loop
    old_text := p_replacements[i][1];
    new_text := p_replacements[i][2];
    occurrences := (length(before_src) - length(replace(before_src, old_text, ''))) / length(old_text);
    if occurrences <> 1 then
      raise exception 'ALIGN: % contains % occurrence(s) of the text to replace, expected 1: %',
        p_signature, occurrences, old_text;
    end if;
    expected_src := replace(expected_src, old_text, new_text);
    new_def := replace(new_def, old_text, new_text);
  end loop;
  execute new_def;
  if (select prosrc from pg_proc where oid = fn) is distinct from expected_src then
    raise exception 'ALIGN: % body is not exactly the live body with the intended replacements', p_signature;
  end if;
  if (select concat_ws('|', proargtypes::text, prorettype::text, prolang::text, prosecdef::text,
                       provolatile::text, coalesce(proconfig::text, ''), coalesce(proacl::text, ''), proowner::text)
        from pg_proc where oid = fn) is distinct from before_attrs then
    raise exception 'ALIGN: % attributes changed', p_signature;
  end if;
end
$align$;

do $$
declare
  body text;
begin
  -- The recommendation reads item.markup_override, so the row must already be
  -- loaded into `item` before the recommendation is computed.
  select prosrc into body from pg_proc
   where oid = to_regprocedure('public.update_print_spec(uuid,text,text,numeric,numeric,text,text)');
  if position('item public.billing_items;' in body) = 0
     or position('select * into item' in body) = 0
     or position('select * into item' in body) > position('next_suggested := case' in body) then
    raise exception 'ALIGN: update_print_spec does not load item before its recommendation';
  end if;
  select prosrc into body from pg_proc
   where oid = to_regprocedure('public.review_print_price(uuid,numeric,numeric,numeric,boolean,text,text,text)');
  if position('item public.billing_items;' in body) = 0
     or position('select * into item' in body) = 0
     or position('select * into item' in body) > position('expected_amount := case' in body) then
    raise exception 'ALIGN: review_print_price does not load item before its recommendation';
  end if;
end $$;

-- update_print_spec (7 args, p_print_cost): the recommendation formula only.
select pg_temp.align_live_function(
  'public.update_print_spec(uuid,text,text,numeric,numeric,text,text)',
  array[[
    'ceil((next_cost / (1 - case when next_cost <= 50 then 0.5 when next_cost <= 100 then 0.4 else 0.3 end) - 0.000000001) / 5) * 5',
    'public.print_markup_recommended_amount(next_cost, item.markup_override)'
  ]]);

-- review_print_price (8 args, p_print_cost): the recommendation formula, and
-- the enum cast whose absence made every call fail at runtime.
select pg_temp.align_live_function(
  'public.review_print_price(uuid,numeric,numeric,numeric,boolean,text,text,text)',
  array[
    ['ceil((p_print_cost / (1 - case when p_print_cost <= 50 then 0.5 when p_print_cost <= 100 then 0.4 else 0.3 end) - 0.000000001) / 5) * 5',
     'public.print_markup_recommended_amount(p_print_cost, item.markup_override)'],
    ['price_review_status = case when coalesce(p_confirm, false) then ''CONFIRMED'' else ''REVIEW_REQUIRED'' end,',
     'price_review_status = (case when coalesce(p_confirm, false) then ''CONFIRMED'' else ''REVIEW_REQUIRED'' end)::public.price_review_status,']
  ]);

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
