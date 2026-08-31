-- Harden helper functions used by RLS policies.
--
-- Role lookup does not need SECURITY DEFINER: authenticated users already
-- have the users_read policy, and the lookup is restricted to auth.uid().
create or replace function public.current_role_name() returns public.user_role
language sql stable security invoker set search_path = public as $$
  select role from public.users where id = auth.uid()
$$;

alter function public.is_designer() set search_path = public;
alter function public.is_office() set search_path = public;
alter function public.can_invoice() set search_path = public;
alter function public.can_take_payment() set search_path = public;

-- This function is invoked only by the auth.users trigger, never through the
-- Data API. Keep it available to the owner for trigger execution, but remove
-- direct API execution from untrusted application roles.
revoke execute on function public.handle_new_auth_user() from public, anon, authenticated, service_role;
