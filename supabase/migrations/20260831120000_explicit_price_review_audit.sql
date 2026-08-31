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

-- These functions are trigger-only entry points.
revoke all on function public.audit_print_price_suggestion_insert() from public, anon, authenticated, service_role;
revoke all on function public.audit_print_price_review_change() from public, anon, authenticated, service_role;
