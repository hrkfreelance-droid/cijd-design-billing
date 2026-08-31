-- Keep the print total derived from quantity and unit price at the database
-- boundary too. This migration is pending review and is not applied here.
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
  if round(p_amount, 2) <> round(item.quantity * p_unit_price, 2) then
    raise exception 'INVALID' using detail = 'Print total must equal quantity x unit price.';
  end if;

  perform set_config('cijd.printing_action', 'price', true);
  update public.billing_items set
    suggested_unit_price = coalesce(suggested_unit_price, unit_price),
    suggested_amount = coalesce(suggested_amount, amount),
    unit_price = round(p_unit_price, 2),
    amount = round(p_amount, 2),
    custom_amount = false,
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
