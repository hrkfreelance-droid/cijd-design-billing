-- RLS decides which rows Office may reach. This trigger also decides which
-- columns Office may change when a client bypasses the application API.
create or replace function public.guard_office_billing_item_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  role_name public.user_role := public.current_role_name();
begin
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
    if old.id is distinct from new.id
       or old.project_id is distinct from new.project_id
       or old.description is distinct from new.description
       or old.type is distinct from new.type
       or old.quantity is distinct from new.quantity
       or old.unit_price is distinct from new.unit_price
       or old.amount is distinct from new.amount
       or old.custom_amount is distinct from new.custom_amount
       or old.production_status is distinct from new.production_status
       or old.delivered_at is distinct from new.delivered_at
       or old.delivered_by is distinct from new.delivered_by
       or old.invoice_id is distinct from new.invoice_id
       or old.note is distinct from new.note
       or old.created_at is distinct from new.created_at
       or old.created_by is distinct from new.created_by
       or old.deleted_at is distinct from new.deleted_at then
      raise exception 'FORBIDDEN';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_office_billing_item_update on public.billing_items;
create trigger guard_office_billing_item_update
  before update on public.billing_items
  for each row execute function public.guard_office_billing_item_update();

revoke all on function public.guard_office_billing_item_update() from public, anon, authenticated, service_role;
