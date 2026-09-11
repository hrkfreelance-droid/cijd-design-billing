-- Explicit price review is the source of truth for current PRINT work.
-- Existing rows are not backfilled and no business data is rewritten here.

-- Record a suggested price when a new operational PRINT row enters the ledger.
create or replace function public.audit_print_price_suggestion_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.type = 'PRINT'
     and lower(btrim(new.created_by)) <> 'import'
     and new.price_review_status = 'REVIEW_REQUIRED' then
    insert into public.audit_logs (actor, action, entity, entity_id, detail)
    values (
      coalesce(new.created_by, 'system'),
      'price.suggested',
      'billing_item',
      new.id,
      coalesce(new.price_reason, new.description)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists audit_print_price_suggestion_after_insert on public.billing_items;
create trigger audit_print_price_suggestion_after_insert
  after insert on public.billing_items
  for each row execute function public.audit_print_price_suggestion_insert();

-- Direct table updates are still observable, while the controlled RPCs retain
-- their existing price.edit/price.confirm audit entries. A price confirmation
-- is invalidated whenever a current PRINT row returns to review.
create or replace function public.audit_print_price_review_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  action_name text := coalesce(current_setting('cijd.printing_action', true), '');
begin
  if old.type = 'PRINT'
     and lower(btrim(old.created_by)) <> 'import'
     and old.price_review_status = 'CONFIRMED'
     and new.price_review_status = 'REVIEW_REQUIRED' then
    insert into public.audit_logs (actor, action, entity, entity_id, detail)
    values (
      coalesce(new.updated_by, old.updated_by, 'system'),
      'price.confirmation_invalidated',
      'billing_item',
      new.id,
      coalesce(new.description, old.description)
    );
  end if;

  -- The application-side generic update path does not have a dedicated RPC.
  -- Its structured transition is logged here; spec/price RPCs already log the
  -- more specific event and set a transaction-local marker.
  if new.type = 'PRINT'
     and lower(btrim(new.created_by)) <> 'import'
     and new.price_review_status = 'REVIEW_REQUIRED'
     and old.price_review_status is distinct from new.price_review_status
     and action_name = '' then
    insert into public.audit_logs (actor, action, entity, entity_id, detail)
    values (
      coalesce(new.updated_by, old.updated_by, 'system'),
      'price.suggested',
      'billing_item',
      new.id,
      coalesce(new.price_reason, new.description)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists audit_print_price_review_after_update on public.billing_items;
create trigger audit_print_price_review_after_update
  after update on public.billing_items
  for each row execute function public.audit_print_price_review_change();

-- Keep Billing from confirming or editing a PRINT price through a direct
-- table update. Printing owns these columns; Billing may only move the
-- billing-status state after production and price gates have passed.
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
       or old.print_size is distinct from new.print_size
       or old.price_review_status is distinct from new.price_review_status
       or old.suggested_unit_price is distinct from new.suggested_unit_price
       or old.suggested_amount is distinct from new.suggested_amount
       or old.price_source is distinct from new.price_source
       or old.price_reason is distinct from new.price_reason
       or old.price_confirmed_by is distinct from new.price_confirmed_by
       or old.price_confirmed_at is distinct from new.price_confirmed_at
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

-- These functions are trigger-only entry points.
revoke all on function public.audit_print_price_suggestion_insert() from public, anon, authenticated, service_role;
revoke all on function public.audit_print_price_review_change() from public, anon, authenticated, service_role;
revoke all on function public.guard_office_billing_item_update() from public, anon, authenticated, service_role;
