-- HARNESS BASELINE ONLY — not a migration.
--
-- Reconstructs the three live Sep 12 migrations from the live inspection
-- (supabase_migrations.schema_migrations); their SQL is not in a repository:
--   20260912084617 add_print_margin_override  — column + constraint: exact
--   20260912084732 print_margin_rpc           — update_print_spec_with_margin,
--                                               review_print_price_with_margin
--   20260912092409 print_cost_basis_rpc       — update_print_spec_with_costs
-- The three functions have their exact live signatures and placeholder
-- bodies: the release migrations never touch them, and the harness proves it
-- by fingerprinting every definition before and after.

alter table public.billing_items add column if not exists margin_override numeric(5, 4);
alter table public.billing_items add constraint billing_items_margin_override_range
  check (margin_override is null or (margin_override >= 0 and margin_override < 1));

create or replace function public.update_print_spec_with_margin(
  p_item_id uuid, p_description text, p_print_size text, p_quantity numeric,
  p_print_cost numeric, p_margin_override numeric, p_note text, p_actor text
) returns public.billing_items
language plpgsql security invoker set search_path = public as $$
declare item public.billing_items;
begin
  -- PLACEHOLDER for the live body: cost / (1 - margin), $5 rounding.
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
  -- PLACEHOLDER for the live body.
  select * into item from public.billing_items where id = p_item_id;
  return item;
end $$;

create or replace function public.update_print_spec_with_costs(
  p_item_id uuid, p_description text, p_print_size text, p_quantity numeric,
  p_print_cost numeric, p_print_cost_amount numeric, p_print_cost_unit_price numeric,
  p_margin_override numeric, p_billing_price_manual boolean, p_note text, p_actor text
) returns public.billing_items
language plpgsql security invoker set search_path = public as $$
declare item public.billing_items;
begin
  -- PLACEHOLDER for the live body (keeps print_cost / print_cost_amount /
  -- print_cost_unit_price / margin_override / billing_price_manual in sync).
  select * into item from public.billing_items where id = p_item_id;
  return item;
end $$;
