-- Row level security.
--
-- Roles do not merely hide navigation: the database refuses to return rows the
-- signed-in role has no business seeing. In particular, billing and accounting
-- cannot read work that has not been delivered — not through the app, not
-- through the API, not with a hand-written query.

create or replace function current_role_name() returns user_role
language sql stable security definer set search_path = public as $$
  select role from users where id = auth.uid()
$$;

create or replace function is_designer() returns boolean
language sql stable as $$
  select current_role_name() in ('DESIGNER', 'ADMIN')
$$;

create or replace function is_office() returns boolean
language sql stable as $$
  select current_role_name() in ('BILLING', 'ACCOUNTING', 'ADMIN')
$$;

create or replace function can_invoice() returns boolean
language sql stable as $$
  select current_role_name() in ('BILLING', 'ADMIN')
$$;

create or replace function can_take_payment() returns boolean
language sql stable as $$
  select current_role_name() in ('ACCOUNTING', 'ADMIN')
$$;

alter table users enable row level security;
alter table clients enable row level security;
alter table projects enable row level security;
alter table billing_items enable row level security;
alter table invoices enable row level security;
alter table invoice_items enable row level security;
alter table payments enable row level security;
alter table notification_logs enable row level security;
alter table audit_logs enable row level security;
alter table telegram_sessions enable row level security;

-- Everyone signed in may read the people list; only admins may change it.
create policy users_read on users for select to authenticated using (true);
create policy users_write on users for all to authenticated
  using (current_role_name() = 'ADMIN') with check (current_role_name() = 'ADMIN');

create policy clients_read on clients for select to authenticated using (true);
create policy clients_write on clients for all to authenticated
  using (is_designer()) with check (is_designer());

-- Office sees a project only once something on it has been delivered.
create policy projects_read on projects for select to authenticated using (
  is_designer()
  or exists (
    select 1 from billing_items item
    where item.project_id = projects.id
      and item.production_status = 'DELIVERED'
      and item.deleted_at is null
  )
);
create policy projects_write on projects for all to authenticated
  using (is_designer()) with check (is_designer());

-- The heart of it: undelivered work is invisible outside the design side.
create policy billing_items_read on billing_items for select to authenticated using (
  is_designer() or production_status = 'DELIVERED'
);
create policy billing_items_designer_write on billing_items for all to authenticated
  using (is_designer()) with check (is_designer());
-- Billing may only ever touch delivered work, and only to bill it.
create policy billing_items_office_update on billing_items for update to authenticated
  using (can_invoice() and production_status = 'DELIVERED')
  with check (can_invoice() and production_status = 'DELIVERED');
create policy billing_items_payment_update on billing_items for update to authenticated
  using (can_take_payment() and production_status = 'DELIVERED')
  with check (can_take_payment() and production_status = 'DELIVERED');

-- Invoices and payments never reach the design side.
create policy invoices_read on invoices for select to authenticated using (is_office());
create policy invoices_write on invoices for all to authenticated
  using (can_invoice() or can_take_payment())
  with check (can_invoice() or can_take_payment());

create policy invoice_items_read on invoice_items for select to authenticated using (is_office());
create policy invoice_items_write on invoice_items for all to authenticated
  using (can_invoice()) with check (can_invoice());

create policy payments_read on payments for select to authenticated using (is_office());
create policy payments_write on payments for all to authenticated
  using (can_take_payment()) with check (can_take_payment());

create policy notifications_read on notification_logs for select to authenticated
  using (is_office() or is_designer());
create policy notifications_write on notification_logs for all to authenticated
  using (is_office() or is_designer()) with check (is_office() or is_designer());

create policy audit_read on audit_logs for select to authenticated
  using (current_role_name() = 'ADMIN');
create policy audit_write on audit_logs for insert to authenticated with check (true);

-- Only the designer side talks to the bot.
create policy telegram_sessions_all on telegram_sessions for all to authenticated
  using (is_designer()) with check (is_designer());

-- New sign-ups get a profile row. Promote to BILLING/ACCOUNTING/ADMIN in the
-- dashboard; nobody can grant themselves a role.
create or replace function handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into users (id, name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    'DESIGNER'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();
