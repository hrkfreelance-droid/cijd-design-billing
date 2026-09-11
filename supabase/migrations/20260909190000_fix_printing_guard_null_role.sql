-- Make the printing guard's early return null-safe.
--
-- `guard_printing_billing_item_update` starts with
--
--     if role_name <> 'PRINTING' then return new; end if;
--
-- A trusted server-side session (Pilot / Access Link) reaches the database
-- through the service key and has no `auth.uid()`, so `current_role_name()`
-- is NULL. `NULL <> 'PRINTING'` is NULL, not true, so that early return never
-- fires; execution falls through to the print-only check below it and every
-- update to a DESIGN, RESIZE or OTHER item is refused as FORBIDDEN — which
-- also blocks `create_invoice`, since billing an item is an update.
--
-- `is distinct from` gives the intended answer for NULL. Behaviour for all
-- five real roles is unchanged: PRINTING still gets the full guard, and
-- everyone else still returns early exactly as before. The function body
-- below is otherwise identical to 20260909120000.
create or replace function public.guard_printing_billing_item_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  role_name public.user_role := public.current_role_name();
  action_name text := coalesce(current_setting('cijd.printing_action', true), '');
  billing_action_name text := coalesce(current_setting('cijd.billing_action', true), '');
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

  if billing_action_name = 'billing_price' then
    if old.id is distinct from new.id
       or old.project_id is distinct from new.project_id
       or old.description is distinct from new.description
       or old.type is distinct from new.type
       or old.quantity is distinct from new.quantity
       or old.unit_price is distinct from new.unit_price
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
