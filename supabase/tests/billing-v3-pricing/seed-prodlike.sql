-- Production-like rows written exactly as stored (triggers off), including
-- prices from the OLD margin rule, manual overrides, invoiced and paid work.
set session_replication_role = replica;
insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b'),
  ('00000000-0000-0000-0000-00000000000c'), ('00000000-0000-0000-0000-00000000000d'),
  ('00000000-0000-0000-0000-00000000000e');
-- active is explicit: 20260902121000 makes new users inactive by default.
insert into public.users (id, name, role, active) values
  ('00000000-0000-0000-0000-00000000000a', 'Admin A', 'ADMIN', true),
  ('00000000-0000-0000-0000-00000000000b', 'Billing B', 'BILLING', true),
  ('00000000-0000-0000-0000-00000000000c', 'Printing C', 'PRINTING', true),
  ('00000000-0000-0000-0000-00000000000d', 'Designer D', 'DESIGNER', true),
  ('00000000-0000-0000-0000-00000000000e', 'Accounting E', 'ACCOUNTING', true);
insert into public.clients (id, name, active, created_at) values
  ('10000000-0000-0000-0000-000000000001', 'Ringer Hut', true, '2026-09-01T00:00:00Z');
insert into public.projects (id, client_id, name, date, note, created_at, created_by, updated_at, updated_by, billing_readiness) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Auto priced (old rule)', '2026-09-10', 'note A', '2026-09-10T01:00:00Z', 'Hiroki', '2026-09-10T01:00:00Z', 'Hiroki', 'AUTO'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Manual override', '2026-09-11', null, '2026-09-11T01:00:00Z', 'Hiroki', '2026-09-11T02:00:00Z', 'Hiroki', 'READY'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Invoiced + paid', '2026-09-12', 'billed', '2026-09-12T01:00:00Z', 'Hiroki', '2026-09-12T03:00:00Z', 'Hiroki', 'AUTO');
insert into public.invoices (id, client_id, invoice_number, invoice_date, amount, status, receipt_status, created_at, created_by, updated_at, updated_by) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'INV-001', '2026-09-15', 880, 'PAID', 'PENDING', '2026-09-15T00:00:00Z', 'Billing B', '2026-09-16T00:00:00Z', 'Billing B');
insert into public.billing_items (id, project_id, description, type, service_type, quantity, unit_price, amount, custom_amount, production_status, billing_status, delivered_at, delivered_by, invoice_id, print_cost, print_size, price_review_status, suggested_unit_price, suggested_amount, billing_price_manual, price_confirmed_by, price_confirmed_at, note, created_at, created_by, updated_at, updated_by) values
  -- cost 40 → old rule $80 (new rule would say $60)
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Flyers', 'PRINT', 'PRINTING', 180, 0.44, 80, false, 'IN_PROGRESS', 'NOT_READY', null, null, null, 40, 'A5', 'REVIEW_REQUIRED', 0.44, 80, false, null, null, null, '2026-09-10T01:00:00Z', 'Hiroki', '2026-09-10T01:00:00Z', 'Hiroki'),
  ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'Logo', 'DESIGN', 'DESIGN', 1, 150, 150, false, 'COMPLETED', 'NOT_READY', '2026-09-10T02:00:00Z', 'Designer D', null, null, null, 'NOT_REQUIRED', null, null, false, null, null, null, '2026-09-10T01:05:00Z', 'Hiroki', '2026-09-10T01:05:00Z', 'Hiroki'),
  -- manual $4.30 × 180 = $774
  ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000002', 'Posters', 'PRINT', 'PRINTING', 180, 4.3, 774, true, 'DELIVERED', 'READY_TO_INVOICE', '2026-09-11T05:00:00Z', 'Printing C', null, 645, 'A2', 'CONFIRMED', 5.14, 925, true, 'Billing B', '2026-09-11T02:00:00Z', 'rush', '2026-09-11T01:00:00Z', 'Hiroki', '2026-09-11T02:00:00Z', 'Billing B'),
  -- invoiced/paid
  ('40000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000003', 'Banners', 'PRINT', 'PRINTING', 2, 365, 730, false, 'DELIVERED', 'PAID', '2026-09-12T05:00:00Z', 'Printing C', '30000000-0000-0000-0000-000000000001', 500, null, 'CONFIRMED', 365, 730, false, 'Billing B', '2026-09-12T03:00:00Z', null, '2026-09-12T01:00:00Z', 'Hiroki', '2026-09-12T03:00:00Z', 'Hiroki'),
  ('40000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000003', 'Resize', 'RESIZE', 'RESIZE', 3, 50, 150, false, 'COMPLETED', 'PAID', '2026-09-12T05:00:00Z', 'Designer D', '30000000-0000-0000-0000-000000000001', null, null, 'NOT_REQUIRED', null, null, false, null, null, null, '2026-09-12T01:10:00Z', 'Hiroki', '2026-09-12T03:00:00Z', 'Hiroki'),
  -- imported history
  ('40000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000001', 'Old job', 'PRINT', 'PRINTING', 100, 1, 100, true, 'DELIVERED', 'NOT_READY', '2026-01-01T00:00:00Z', 'import', null, 70, null, null, null, null, false, null, null, null, '2026-01-01T00:00:00Z', 'import', '2026-01-01T00:00:00Z', 'import');
insert into public.invoice_items (invoice_id, billing_item_id) values
  ('30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000004'),
  ('30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000005');
insert into public.payments (id, invoice_id, amount, paid_at, slip, created_at, created_by) values
  ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 880, '2026-09-16', 'slip-1', '2026-09-16T00:00:00Z', 'Billing B');
-- Live print-cost-basis workflow (Sep 12): unit/amount cost basis, one confirmed.
update public.billing_items set
  print_cost_unit_price = 3.583333, print_cost_amount = 645.00,
  print_cost_confirmed_by = 'Printing C', print_cost_confirmed_at = '2026-09-12T09:30:00Z'
  where id = '40000000-0000-0000-0000-000000000003';
update public.billing_items set print_cost_unit_price = 0.222222, print_cost_amount = 40.00
  where id = '40000000-0000-0000-0000-000000000001';
update public.billing_items set print_cost_unit_price = 250.000000, print_cost_amount = 500.00
  where id = '40000000-0000-0000-0000-000000000004';
insert into public.billing_items (id, project_id, description, type, service_type, quantity, unit_price, amount, custom_amount, production_status, billing_status, delivered_at, delivered_by, invoice_id, print_cost, print_cost_unit_price, print_cost_amount, price_review_status, price_confirmed_by, price_confirmed_at, suggested_unit_price, suggested_amount, billing_price_manual, created_at, created_by, updated_at, updated_by) values
  -- cost basis only (print_cost NULL): the app reads printCost from print_cost_amount
  ('40000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000002', 'Stickers', 'PRINT', 'PRINTING', 500, 0.3, 150, true, 'DELIVERED', 'READY_TO_INVOICE', '2026-09-12T10:00:00Z', 'Printing C', null, null, 0.180000, 90.00, 'CONFIRMED', 'Billing B', '2026-09-12T10:00:00Z', 0.3, 150, true, '2026-09-12T09:00:00Z', 'Hiroki', '2026-09-12T10:00:00Z', 'Printing C');
set session_replication_role = origin;
