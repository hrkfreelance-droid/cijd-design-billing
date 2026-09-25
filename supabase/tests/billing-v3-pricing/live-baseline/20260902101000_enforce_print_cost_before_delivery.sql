-- Enforce the operational order: confirm PRINT cost before delivery.
-- This makes the API/database rule match the Printing UI rather than allowing
-- an unpriced print item to be delivered into a review limbo.

create or replace function public.set_item_delivery(
  p_item_id uuid,
  p_delivered boolean,
  p_actor text
) returns public.billing_items
language plpgsql set search_path = public as $$
declare
  item public.billing_items;
  actor_name text := coalesce((select name from public.users where id = auth.uid()), nullif(btrim(p_actor), ''), 'Unknown');
begin
  select * into item from public.billing_items where id = p_item_id and deleted_at is null;
  if not found then raise exception 'NOT_FOUND' using detail = 'Billing item was not found.'; end if;
  if lower(btrim(item.created_by)) = 'import' then raise exception 'HISTORY_READ_ONLY'; end if;
  if item.type <> 'PRINT' then raise exception 'WRONG_PRODUCTION_ACTION' using detail = 'Creative work must be marked complete, not delivered.'; end if;
  if item.billing_status in ('INVOICED','PAID') then raise exception 'ITEM_LOCKED'; end if;
  if p_delivered and coalesce(item.price_review_status::text,'REVIEW_REQUIRED') <> 'CONFIRMED' then
    raise exception 'PRICE_REVIEW_REQUIRED' using detail = 'Confirm the print cost before marking this item delivered.';
  end if;

  perform set_config('cijd.printing_action', 'delivery', true);
  update public.billing_items set
    production_status = case when p_delivered then 'DELIVERED' else 'IN_PROGRESS' end::public.production_status,
    delivered_at = case when p_delivered then now() else null end,
    delivered_by = case when p_delivered then actor_name else null end,
    billing_status = case when p_delivered then 'READY_TO_INVOICE'::public.billing_status else 'NOT_READY'::public.billing_status end,
    updated_at = now(),
    updated_by = actor_name
  where id = p_item_id returning * into item;

  insert into public.audit_logs (actor, action, entity, entity_id, detail)
  values (actor_name, case when p_delivered then 'item.deliver' else 'item.undeliver' end, 'billing_item', item.id, item.description);
  return item;
end;
$$;

create or replace function public.set_project_delivery(
  p_project_id uuid,
  p_delivered boolean,
  p_actor text
) returns setof public.billing_items
language plpgsql set search_path = public as $$
declare
  item public.billing_items;
  touched integer := 0;
begin
  if coalesce(public.current_role_name()::text,'') = 'PRINTING' then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from public.projects where id = p_project_id and deleted_at is null) then raise exception 'NOT_FOUND'; end if;
  if not exists (select 1 from public.billing_items where project_id = p_project_id and deleted_at is null) then raise exception 'NO_ITEMS'; end if;

  if p_delivered and exists (
    select 1 from public.billing_items
    where project_id = p_project_id
      and deleted_at is null
      and billing_status not in ('INVOICED','PAID')
      and type = 'PRINT'
      and coalesce(price_review_status::text,'REVIEW_REQUIRED') <> 'CONFIRMED'
  ) then
    raise exception 'PRICE_REVIEW_REQUIRED' using detail = 'Confirm every print cost before completing this project.';
  end if;

  for item in
    select * from public.billing_items
    where project_id = p_project_id and deleted_at is null and billing_status not in ('INVOICED','PAID')
    order by created_at
  loop
    touched := touched + 1;
    update public.billing_items set
      production_status = case when p_delivered then
        case when item.type='PRINT' then 'DELIVERED' else 'COMPLETED' end::public.production_status
        else 'IN_PROGRESS'::public.production_status end,
      delivered_at = case when p_delivered then now() else null end,
      delivered_by = case when p_delivered then p_actor else null end,
      billing_status = case
        when item.billing_status='NEEDS_REVIEW' and item.type <> 'PRINT' then item.billing_status
        when p_delivered then 'READY_TO_INVOICE'::public.billing_status
        else 'NOT_READY'::public.billing_status
      end,
      updated_at=now(), updated_by=p_actor
    where id=item.id returning * into item;
    insert into public.audit_logs (actor, action, entity, entity_id, detail)
    values (
      p_actor,
      case when p_delivered and item.type='PRINT' then 'item.deliver'
           when p_delivered then 'item.complete'
           when item.type='PRINT' then 'item.undeliver'
           else 'item.uncomplete' end,
      'billing_item', item.id, item.description
    );
    return next item;
  end loop;
  if touched=0 then raise exception 'ITEM_LOCKED'; end if;
end;
$$;
