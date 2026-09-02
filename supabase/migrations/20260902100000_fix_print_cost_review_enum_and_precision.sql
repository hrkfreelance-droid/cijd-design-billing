-- Corrective migration for the print-cost review flow.
-- The previous RPC used a text CASE expression for an enum column, which made
-- Confirm cost fail at runtime. Keep unit cost precise enough for totals such
-- as $25 / 1000 pcs while keeping customer-facing totals at two decimals.

alter table public.billing_items
  alter column print_cost_unit_price type numeric(14,6)
  using print_cost_unit_price::numeric(14,6);

create or replace function public.review_print_price(
  p_item_id uuid,
  p_unit_price numeric,
  p_amount numeric,
  p_confirm boolean,
  p_price_source text,
  p_price_reason text,
  p_actor text
) returns public.billing_items
language plpgsql set search_path = public as $$
declare
  item public.billing_items;
  actor_name text := coalesce((select name from public.users where id = auth.uid()), nullif(btrim(p_actor), ''), 'Unknown');
  suggested_total numeric;
  suggested_unit numeric;
begin
  if auth.role() <> 'service_role' and coalesce(public.current_role_name()::text,'') not in ('DESIGNER','PRINTING','ADMIN') then raise exception 'FORBIDDEN'; end if;
  select * into item from public.billing_items where id = p_item_id and deleted_at is null;
  if not found then raise exception 'NOT_FOUND' using detail = 'Billing item was not found.'; end if;
  if item.type <> 'PRINT' then raise exception 'INVALID_PRINT'; end if;
  if lower(btrim(item.created_by)) = 'import' then raise exception 'HISTORY_READ_ONLY'; end if;
  if item.billing_status in ('INVOICED','PAID') then raise exception 'ITEM_LOCKED'; end if;
  if p_unit_price is null or p_unit_price <= 0 or p_amount is null or p_amount <= 0 then
    raise exception 'INVALID' using detail = 'Print cost must be greater than zero.';
  end if;
  if round(p_amount,2) <> round(item.quantity * p_unit_price,2) then
    raise exception 'INVALID' using detail = 'Print cost total must equal quantity × cost per unit.';
  end if;

  suggested_total := public.round_print_billing_price(round(p_amount,2));
  suggested_unit := round(suggested_total / item.quantity, 2);

  perform set_config('cijd.printing_action', 'price', true);
  update public.billing_items set
    print_cost_unit_price = round(p_unit_price,6),
    print_cost_amount = round(p_amount,2),
    print_cost_confirmed_by = case when coalesce(p_confirm,false) then actor_name else null end,
    print_cost_confirmed_at = case when coalesce(p_confirm,false) then now() else null end,
    suggested_unit_price = suggested_unit,
    suggested_amount = suggested_total,
    unit_price = case when coalesce(billing_price_manual,false) then unit_price else suggested_unit end,
    amount = case when coalesce(billing_price_manual,false) then amount else suggested_total end,
    custom_amount = case when coalesce(billing_price_manual,false) then custom_amount else true end,
    price_source = case when p_price_source is null then price_source else nullif(btrim(p_price_source), '') end,
    price_reason = coalesce(nullif(btrim(p_price_reason), ''), format('Cost %s → suggested billing %s', round(p_amount,2), suggested_total)),
    price_review_status = case
      when coalesce(p_confirm,false) then 'CONFIRMED'::public.price_review_status
      else 'REVIEW_REQUIRED'::public.price_review_status
    end,
    price_confirmed_by = case when coalesce(p_confirm,false) then actor_name else null end,
    price_confirmed_at = case when coalesce(p_confirm,false) then now() else null end,
    billing_status = case
      when not coalesce(p_confirm,false) and production_status in ('DELIVERED','COMPLETED') then 'NEEDS_REVIEW'::public.billing_status
      when coalesce(p_confirm,false) and production_status in ('DELIVERED','COMPLETED') and billing_status in ('NOT_READY','NEEDS_REVIEW') then 'READY_TO_INVOICE'::public.billing_status
      else billing_status
    end,
    updated_at = now(),
    updated_by = actor_name
  where id = p_item_id returning * into item;

  insert into public.audit_logs (actor, action, entity, entity_id, detail)
  values (
    actor_name,
    case when coalesce(p_confirm,false) then 'print.cost.confirm' else 'print.cost.edit' end,
    'billing_item',
    item.id,
    format('cost=%s suggested=%s final=%s', item.print_cost_amount, item.suggested_amount, item.amount)
  );
  return item;
end;
$$;
