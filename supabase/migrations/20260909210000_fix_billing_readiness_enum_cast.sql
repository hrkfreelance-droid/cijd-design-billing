-- CIJD Billing V2: cast readiness status changes to the existing enum.
-- Additive function replacement only; no rows are changed by this migration.

create or replace function public.set_project_billing_readiness(
  p_project_id uuid,
  p_readiness text,
  p_actor text
) returns public.projects
language plpgsql security invoker set search_path = public as $$
declare
  project_row public.projects;
  pending_count integer;
begin
  if p_readiness not in ('AUTO', 'READY', 'IN_PROGRESS') then
    raise exception 'INVALID' using detail = 'Invalid billing readiness.';
  end if;
  select * into project_row from public.projects
    where id = p_project_id and deleted_at is null for update;
  if not found then
    raise exception 'NOT_FOUND' using detail = 'Project was not found.';
  end if;
  if p_readiness = 'READY' then
    if not exists (
      select 1 from public.billing_items
      where project_id = p_project_id and deleted_at is null
        and billing_status not in ('INVOICED', 'PAID')
    ) then
      raise exception 'NO_ITEMS' using detail = 'Add what should be billed first.';
    end if;
    select count(*) into pending_count from public.billing_items
      where project_id = p_project_id and deleted_at is null
        and billing_status not in ('INVOICED', 'PAID') and amount is null;
    if pending_count > 0 then
      raise exception 'PRICE_REQUIRED' using detail = format('%s item still needs a billing price.', pending_count);
    end if;
  end if;

  update public.projects set
    billing_readiness = p_readiness,
    updated_at = now(),
    updated_by = p_actor
    where id = p_project_id
    returning * into project_row;

  if p_readiness in ('READY', 'IN_PROGRESS') then
    update public.billing_items set
      billing_status = (case when p_readiness = 'READY' then 'READY_TO_INVOICE' else 'NOT_READY' end)::billing_status,
      billing_override = (p_readiness = 'READY'),
      updated_at = now(),
      updated_by = p_actor
      where project_id = p_project_id and deleted_at is null
        and billing_status not in ('INVOICED', 'PAID');
  else
    update public.billing_items set
      billing_override = false,
      updated_at = now(),
      updated_by = p_actor
      where project_id = p_project_id and deleted_at is null
        and billing_status not in ('INVOICED', 'PAID');
  end if;

  insert into public.audit_logs (actor, action, entity, entity_id, detail)
    values (p_actor, 'project.billingReadiness', 'project', p_project_id, p_readiness);
  return project_row;
end;
$$;

revoke all on function public.set_project_billing_readiness(uuid, text, text) from public, anon;
grant execute on function public.set_project_billing_readiness(uuid, text, text) to authenticated, service_role;
