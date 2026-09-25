-- HARNESS BASELINE ONLY — not a migration.
--
-- Brings the local test database from this repository's migration chain
-- (ends 20260909220000) up to the LIVE schema, which additionally has:
--   20260912084617 add_print_margin_override
--   20260912084732 print_margin_rpc
--   20260912092409 print_cost_basis_rpc
-- Their SQL is not in any repository available here, so:
--   * the live COLUMNS are reproduced exactly (names and types from the live
--     database inspection);
--   * the live FUNCTIONS are placeholders with the live names: they exist so
--     the harness can prove the release migration neither replaces nor
--     alters them (definition fingerprints before/after must be identical).
-- If supabase/tests/billing-v3-pricing/live-schema/*.sql exists (the output
-- of live-schema-export.sql, i.e. the real live definitions), run.sh applies
-- it after this file, replacing these placeholders.

alter table public.billing_items add column if not exists margin_override numeric(5, 4);
alter table public.billing_items alter column print_cost_unit_price type numeric(14, 6);
alter table public.billing_items alter column print_cost_amount type numeric(12, 2);

create or replace function public.round_print_billing_price(p_cost numeric) returns numeric
language sql immutable set search_path = public as $$
  -- PLACEHOLDER for the live body (print_margin_rpc).
  select p_cost
$$;

-- Newer 6-argument update_print_spec (print-cost basis). PLACEHOLDER body.
create or replace function public.update_print_spec(
  p_item_id uuid, p_description text, p_print_size text, p_quantity numeric,
  p_print_cost_unit_price numeric, p_actor text
) returns public.billing_items
language plpgsql security invoker set search_path = public as $$
declare item public.billing_items;
begin
  select * into item from public.billing_items where id = p_item_id;
  return item;
end $$;

-- Newer 7-argument review_print_price (print-cost basis). PLACEHOLDER body.
create or replace function public.review_print_price(
  p_item_id uuid, p_unit_price numeric, p_amount numeric, p_confirm boolean,
  p_price_source text, p_price_reason text, p_actor text
) returns public.billing_items
language plpgsql security invoker set search_path = public as $$
declare item public.billing_items;
begin
  select * into item from public.billing_items where id = p_item_id;
  return item;
end $$;

create or replace function public.update_print_spec_with_margin(
  p_item_id uuid, p_description text, p_print_size text, p_quantity numeric,
  p_print_cost numeric, p_margin_override numeric, p_note text, p_actor text
) returns public.billing_items
language plpgsql security invoker set search_path = public as $$
declare item public.billing_items;
begin
  select * into item from public.billing_items where id = p_item_id;
  return item;
end $$;

create or replace function public.review_print_price_with_margin(
  p_item_id uuid, p_unit_price numeric, p_amount numeric, p_print_cost numeric,
  p_margin_override numeric, p_confirm boolean, p_price_source text, p_price_reason text, p_actor text
) returns public.billing_items
language plpgsql security invoker set search_path = public as $$
declare item public.billing_items;
begin
  select * into item from public.billing_items where id = p_item_id;
  return item;
end $$;
