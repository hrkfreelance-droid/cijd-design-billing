-- Real records only. No sample clients, projects or amounts.
--
-- The 71-row Ringer Hut history is a read-only local/Preview fixture. It is
-- intentionally not applied to the production seed or production Supabase.

insert into clients (id, name, active)
values
  ('11111111-1111-4111-8111-111111111111', 'Ringer Hut', true),
  ('22222222-2222-4222-8222-222222222222', 'DAISHIN', true)
on conflict do nothing;

insert into projects (id, client_id, name, date, created_by, updated_by)
values (
  '33333333-3333-4333-8333-333333333333',
  '11111111-1111-4111-8111-111111111111',
  'RH Kids Promotion',
  current_date,
  'Hiroki',
  'Hiroki'
)
on conflict do nothing;

insert into billing_items (
  id, project_id, description, type, quantity, unit_price, amount,
  production_status, billing_status, delivered_at, delivered_by,
  created_by, updated_by
)
values (
  '44444444-4444-4444-8444-444444444444',
  '33333333-3333-4333-8333-333333333333',
  'Correction',
  'OTHER',
  1,
  15,
  15,
  'DELIVERED',
  'READY_TO_INVOICE',
  now(),
  'Hiroki',
  'Hiroki',
  'Hiroki'
)
on conflict do nothing;
