-- Explicit Data API grants for the application roles.
--
-- Grants decide whether PostgREST can reach an object at all; RLS in
-- 0002_rls.sql remains the row-level boundary. Anonymous clients receive no
-- grant, while authenticated users are still constrained by their role.

grant usage on schema public to authenticated, service_role;

revoke execute on function public.current_role_name() from public;
revoke execute on function public.is_designer() from public;
revoke execute on function public.is_office() from public;
revoke execute on function public.can_invoice() from public;
revoke execute on function public.can_take_payment() from public;
revoke execute on function public.set_item_delivery(uuid, boolean, text) from public;
revoke execute on function public.set_project_delivery(uuid, boolean, text) from public;
revoke execute on function public.create_invoice(uuid, text, date, uuid[], text) from public;
revoke execute on function public.void_invoice(uuid, text) from public;
revoke execute on function public.confirm_payment(uuid, date, text, text) from public;
revoke execute on function public.revert_payment(uuid, text) from public;
revoke execute on function public.handle_new_auth_user() from public;

grant select, insert, update, delete on table
  public.users,
  public.clients,
  public.projects,
  public.billing_items,
  public.invoices,
  public.invoice_items,
  public.payments,
  public.notification_logs,
  public.audit_logs,
  public.telegram_sessions
to authenticated, service_role;

grant execute on function public.current_role_name() to authenticated;
grant execute on function public.is_designer() to authenticated;
grant execute on function public.is_office() to authenticated;
grant execute on function public.can_invoice() to authenticated;
grant execute on function public.can_take_payment() to authenticated;

grant execute on function public.set_item_delivery(uuid, boolean, text)
  to authenticated, service_role;
grant execute on function public.set_project_delivery(uuid, boolean, text)
  to authenticated, service_role;
grant execute on function public.create_invoice(uuid, text, date, uuid[], text)
  to authenticated, service_role;
grant execute on function public.void_invoice(uuid, text)
  to authenticated, service_role;
grant execute on function public.confirm_payment(uuid, date, text, text)
  to authenticated, service_role;
grant execute on function public.revert_payment(uuid, text)
  to authenticated, service_role;
