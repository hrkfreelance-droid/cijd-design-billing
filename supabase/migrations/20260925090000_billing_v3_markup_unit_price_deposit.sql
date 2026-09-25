-- CIJD Billing V3: project deposit, per-line manual markup, Final Unit Price.
--
-- ADDITIVE ONLY. Written against the LIVE schema, which is newer than this
-- repository's migration chain (20260912084617 add_print_margin_override,
-- 20260912084732 print_margin_rpc, 20260912092409 print_cost_basis_rpc are
-- applied live but not present here). Therefore this migration:
--
--   * redefines NO existing function, trigger, policy or constraint — every
--     function below is created with plain CREATE FUNCTION, so if a name and
--     signature already exist the whole migration fails instead of replacing
--     it (update_print_spec, review_print_price, ensure_print_price_review,
--     round_print_billing_price, *_with_margin, the guard triggers and the
--     print-cost-basis workflow are untouched);
--   * updates, deletes and backfills NO row;
--   * adds two NULLABLE columns (every existing row reads NULL):
--       projects.deposit_amount        numeric(12,2)  NULL = no deposit
--       billing_items.markup_override  numeric(6,2)   percent, NULL = band
--     markup_override is markup ON COST (35 = +35%). It is deliberately a
--     separate column from the live gross-margin billing_items.margin_override
--     numeric(5,4), which is neither read nor written here;
--   * adds new narrow RPCs that work inside the EXISTING guard triggers:
--       set_project_deposit, set_billing_item_markup,
--       override_billing_unit_price, print_markup_recommended_amount.
--
-- The markup-on-cost rule for the SQL-side recommendation paths (both
-- update_print_spec / review_print_price overloads, ensure_print_price_review,
-- round_print_billing_price, *_with_margin) is NOT changed here: it must be
-- written against the live function bodies (see
-- supabase/tests/billing-v3-pricing/live-schema-export.sql) in a follow-up
-- migration.
--
-- Runs in one transaction: either everything below applies, or nothing does.

begin;

-- 0. Preflight: refuse to run against an unexpected schema -----------------

do $$
declare
  missing text[] := array[]::text[];
  present text[] := array[]::text[];
  fn text;
begin
  -- Existing objects this release builds on.
  foreach fn in array array[
    'public.override_billing_price(uuid,numeric,text)',
    'public.current_role_name()',
    'public.guard_office_billing_item_update()',
    'public.guard_printing_billing_item_update()'
  ] loop
    if to_regprocedure(fn) is null then missing := missing || fn; end if;
  end loop;
  if array_length(missing, 1) > 0 then
    raise exception 'PREFLIGHT: expected objects are missing: %', missing;
  end if;

  -- New objects must not exist yet (nothing is ever replaced).
  foreach fn in array array[
    'public.print_markup_recommended_amount(numeric,numeric)',
    'public.set_project_deposit(uuid,numeric,text)',
    'public.set_billing_item_markup(uuid,numeric,text)',
    'public.override_billing_unit_price(uuid,numeric,numeric,text)'
  ] loop
    if to_regprocedure(fn) is not null then present := present || fn; end if;
  end loop;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'projects' and column_name = 'deposit_amount') then
    present := present || 'projects.deposit_amount'::text;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'billing_items' and column_name = 'markup_override') then
    present := present || 'billing_items.markup_override'::text;
  end if;
  if array_length(present, 1) > 0 then
    raise exception 'PREFLIGHT: objects already exist, refusing to replace: %', present;
  end if;
end $$;

-- 1. New nullable columns --------------------------------------------------

alter table public.projects
  add column deposit_amount numeric(12, 2);
alter table public.projects
  add constraint projects_deposit_amount_nonnegative
  check (deposit_amount is null or deposit_amount >= 0);

alter table public.billing_items
  add column markup_override numeric(6, 2);
alter table public.billing_items
  add constraint billing_items_markup_override_range
  check (markup_override is null or (markup_override >= 0 and markup_override <= 1000));

-- 2. The markup-on-cost rule, in SQL -----------------------------------------
-- Must agree with recommendedFromCost()/printSellingPriceFromCost() in
-- src/lib/billing-v2/pricing.ts. Reference for the follow-up alignment of
-- the existing recommendation functions; nothing existing calls it yet.

create function public.print_markup_recommended_amount(p_cost numeric, p_markup_percent numeric default null)
returns numeric
language sql immutable set search_path = public as $$
  -- p_markup_percent is a line's manual override (35 = +35%); NULL uses the band.
  select case
    when p_cost is null or p_cost < 0 then null
    else round(p_cost * (1 + coalesce(p_markup_percent / 100,
      case when p_cost <= 50 then 0.5 when p_cost <= 100 then 0.4 else 0.3 end)), 2)
  end;
$$;

grant execute on function public.print_markup_recommended_amount(numeric, numeric) to authenticated, service_role;

-- 3. Final amount + Final Unit Price, in one narrow write ------------------
-- Accepts either direction of a manual price:
--   * a unit price, with amount = round(quantity × unit price, 2), or
--   * a typed total, with unit price = round(amount / quantity, 2).
-- Announces itself as a printing 'price' action (the existing guard and
-- review triggers already understand it) and NOT as 'billing_price', whose
-- guard branch forbids unit_price. Roles whose existing guard refuses a
-- unit_price change (BILLING, ACCOUNTING) get FORBIDDEN; the application
-- then saves the total alone through override_billing_price, exactly as
-- before this release.

create function public.override_billing_unit_price(
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
  insert into public.audit_logs (actor, action, entity, entity_id, detail)
  values (actor_name, 'billing.price.override', 'billing_item', item.id, format('%s/%s', item.unit_price, item.amount));
  return item;
end;
$$;

revoke all on function public.override_billing_unit_price(uuid, numeric, numeric, text) from public, anon;
grant execute on function public.override_billing_unit_price(uuid, numeric, numeric, text) to authenticated, service_role;

-- 4. Project deposit, in one narrow write ----------------------------------
-- NULL clears the deposit. A project with billed (invoiced/paid) work is
-- locked, like its prices. projects has no guard trigger; the role check and
-- the lock are here.

create function public.set_project_deposit(
  p_project_id uuid,
  p_amount numeric,
  p_actor text
) returns public.projects
language plpgsql security definer set search_path = public as $$
declare
  project_row public.projects;
  actor_name text := coalesce((select name from public.users where id = auth.uid()), nullif(btrim(p_actor), ''), 'Unknown');
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if current_role_name() is null
       or current_role_name() not in ('DESIGNER', 'BILLING', 'ACCOUNTING', 'PRINTING', 'ADMIN') then
      raise exception 'FORBIDDEN';
    end if;
  end if;
  if p_amount is not null and p_amount < 0 then
    raise exception 'INVALID' using detail = 'Deposit must be zero or more.';
  end if;
  select * into project_row from public.projects
    where id = p_project_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND' using detail = 'Project was not found.'; end if;
  if exists (
    select 1 from public.billing_items
    where project_id = p_project_id and deleted_at is null
      and billing_status in ('INVOICED', 'PAID')
  ) then
    raise exception 'PROJECT_LOCKED' using detail = 'This project has been billed, so its deposit cannot be changed.';
  end if;

  update public.projects set
    deposit_amount = case when p_amount is null then null else round(p_amount, 2) end,
    updated_at = now(),
    updated_by = actor_name
    where id = p_project_id
    returning * into project_row;
  insert into public.audit_logs (actor, action, entity, entity_id, detail)
    values (actor_name, 'project.deposit', 'project', p_project_id, coalesce(project_row.deposit_amount::text, 'none'));
  return project_row;
end;
$$;

revoke all on function public.set_project_deposit(uuid, numeric, text) from public, anon;
grant execute on function public.set_project_deposit(uuid, numeric, text) to authenticated, service_role;

-- 5. A line's manual markup, in one narrow write -----------------------------
-- NULL returns the line to the 50 / 40 / 30 band. Only markup_override (and
-- the updated_* stamps) move: no amount, unit price, suggestion, print cost,
-- print-cost basis or margin_override is written. Announced as a printing
-- 'price' action so the existing PRINTING guard accepts it; ACCOUNTING, whose
-- existing guard accepts only the billing-price action, uses that instead
-- (its branch requires a priced line).

create function public.set_billing_item_markup(
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

  perform set_config('cijd.printing_action', 'price', true);
  if role_name = 'ACCOUNTING' then
    perform set_config('cijd.billing_action', 'billing_price', true);
  end if;
  update public.billing_items set
    markup_override = case when p_markup_percent is null then null else round(p_markup_percent, 2) end,
    updated_at = now(), updated_by = actor_name
  where id = p_item_id
  returning * into item;
  if not found then raise exception 'FORBIDDEN'; end if;
  perform set_config('cijd.printing_action', '', true);
  perform set_config('cijd.billing_action', '', true);
  insert into public.audit_logs (actor, action, entity, entity_id, detail)
  values (actor_name, 'billing.markup', 'billing_item', item.id, coalesce(item.markup_override::text, 'default'));
  return item;
end;
$$;

revoke all on function public.set_billing_item_markup(uuid, numeric, text) from public, anon;
grant execute on function public.set_billing_item_markup(uuid, numeric, text) to authenticated, service_role;

commit;
