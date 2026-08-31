-- A disabled operator must lose application access even while an old Auth JWT
-- is still technically valid. Keep the role lookup in the database because it
-- is used by every RLS policy.
create or replace function public.current_role_name() returns public.user_role
language sql stable security invoker set search_path = public as $$
  select role
  from public.users
  where id = auth.uid()
    and active = true
$$;

-- These triggers cover direct Supabase writes that do not pass through the
-- local Store. Delivery, invoice, payment and undo operations already write
-- their own audit rows inside the atomic SQL functions.
create or replace function public.audit_user_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.name is distinct from new.name
     or old.role is distinct from new.role
     or old.active is distinct from new.active then
    insert into public.audit_logs (actor, action, entity, entity_id, detail)
    values (
      coalesce(auth.uid()::text, 'system'),
      'user.update',
      'user',
      new.id,
      format('name=%s; role=%s; active=%s', new.name, new.role, new.active)
    );
  end if;
  return new;
end;
$$;

create or replace function public.audit_project_create() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs (actor, action, entity, entity_id, detail)
  values (coalesce(new.created_by, 'system'), 'project.create', 'project', new.id, new.name);
  return new;
end;
$$;

create or replace function public.audit_receipt_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.receipt_status is distinct from new.receipt_status then
    insert into public.audit_logs (actor, action, entity, entity_id, detail)
    values (
      coalesce(new.updated_by, auth.uid()::text, 'system'),
      'invoice.receipt',
      'invoice',
      new.id,
      new.receipt_status::text
    );
  end if;
  return new;
end;
$$;

drop trigger if exists audit_users_after_update on public.users;
create trigger audit_users_after_update
  after update of name, role, active on public.users
  for each row execute function public.audit_user_change();

drop trigger if exists audit_projects_after_insert on public.projects;
create trigger audit_projects_after_insert
  after insert on public.projects
  for each row execute function public.audit_project_create();

drop trigger if exists audit_invoices_after_receipt_update on public.invoices;
create trigger audit_invoices_after_receipt_update
  after update of receipt_status on public.invoices
  for each row execute function public.audit_receipt_change();

-- Trigger functions are not Data API entry points.
revoke all on function public.audit_user_change() from public, anon, authenticated, service_role;
revoke all on function public.audit_project_create() from public, anon, authenticated, service_role;
revoke all on function public.audit_receipt_change() from public, anon, authenticated, service_role;
