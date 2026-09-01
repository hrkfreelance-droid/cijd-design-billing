-- Auth alone is not application access. A profile must be provisioned by an
-- administrator in public.users before a Google account can enter CIJD.
-- Existing profiles and existing data are untouched.

create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
revoke all on function public.handle_new_auth_user() from public, anon, authenticated, service_role;
