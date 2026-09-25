-- New identities must be approved by an Admin before they can enter CIJD.
-- Authentication alone never grants an operational workspace role.

alter table public.users alter column active set default false;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  insert into public.users (id, name, role, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    'DESIGNER',
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;
