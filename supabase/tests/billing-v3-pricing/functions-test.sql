\set ON_ERROR_STOP 1
\set VERBOSITY verbose
-- Runs after 20260925090000 and 20260925100000.
-- Test harness only (plain Postgres): role lookup as 0002 defined it, so a
-- signed-in role session does not recurse through the users_read policy.
-- NOT part of either migration.
alter function public.current_role_name() security definer;
create or replace function pg_temp.act(p_sub text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p_sub, false); end $$;
create or replace function pg_temp.expect_error(p_sql text, p_code text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected % but statement succeeded: %', p_code, p_sql;
exception when others then
  if sqlerrm not like p_code || '%' then raise exception 'expected %, got "%" for %', p_code, sqlerrm, p_sql; end if;
end $$;
create or replace function pg_temp.check(p_ok boolean, p_what text) returns void language plpgsql as $$
begin if not coalesce(p_ok, false) then raise exception 'FAILED: %', p_what; end if; end $$;
-- The Sep 2 / Sep 12 print-cost basis and gross-margin fields of a row.
create or replace function pg_temp.cost_basis(p_id uuid) returns jsonb language sql as $$
  select jsonb_build_object('pcu', print_cost_unit_price, 'pca', print_cost_amount, 'pcb', print_cost_confirmed_by,
    'pcat', print_cost_confirmed_at, 'mo', margin_override)
  from public.billing_items where id = p_id $$;
grant execute on all functions in schema pg_temp to authenticated, anon, service_role;
create temp table cost_basis_before as select id, pg_temp.cost_basis(id) as basis from public.billing_items;
grant select on cost_basis_before to authenticated, anon, service_role;
\set ADMIN   '''00000000-0000-0000-0000-00000000000a'''
\set BILLING '''00000000-0000-0000-0000-00000000000b'''
\set PRINTER '''00000000-0000-0000-0000-00000000000c'''
\set DESIGN  '''00000000-0000-0000-0000-00000000000d'''
\set ACCT    '''00000000-0000-0000-0000-00000000000e'''

-- 1. the rule ------------------------------------------------------------------
do $$ declare r record; begin
  for r in select * from (values (40::numeric, null::numeric, 60::numeric), (50, null, 75), (50.01, null, 70.01),
      (80, null, 112), (100, null, 140), (100.01, null, 130.01), (150, null, 195), (645, null, 838.5),
      (40, 35, 54), (80, 35, 108), (150, 0, 150)) v(cost, markup, expected) loop
    perform pg_temp.check(public.print_markup_recommended_amount(r.cost, r.markup) = r.expected,
      format('rule(%s, %s) = %s', r.cost, r.markup, public.print_markup_recommended_amount(r.cost, r.markup)));
  end loop;
end $$;
select 'ok 1 markup-on-cost rule (default bands + manual override)' as result;

-- 2. active recommendation paths use the rule ------------------------------------
-- 2a. BEFORE INSERT trigger: a new print line with a $40 cost → $60
--     (inserted as the owner: the trigger fires for every writer)
select pg_temp.act('');
insert into public.billing_items (id, project_id, description, type, service_type, quantity, unit_price, amount, print_cost, created_by, updated_by)
values ('40000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-000000000001', 'New flyers', 'PRINT', 'PRINTING', 180, 0, 0, 40, 'Designer D', 'Designer D');
select pg_temp.check(amount = 60 and suggested_amount = 60, 'insert recommends $60 for $40')
  from public.billing_items where id = '40000000-0000-0000-0000-0000000000a1';
-- 2b. 7-arg update_print_spec (the app's): an automatic line follows, $80 → $112
select pg_temp.act(:ADMIN);
set role authenticated;
select amount from public.update_print_spec('40000000-0000-0000-0000-000000000001', null, null, 180, 80, null, 'Admin A');
reset role;
select pg_temp.check(amount = 112 and suggested_amount = 112, 'spec edit $80 → $112')
  from public.billing_items where id = '40000000-0000-0000-0000-000000000001';
-- 2c. …and with a manual 35% markup, $80 → $108; Use default → back to $112
select pg_temp.act(:ADMIN);
set role authenticated;
select markup_override from public.set_billing_item_markup('40000000-0000-0000-0000-000000000001', 35, 'Admin A');
select amount from public.update_print_spec('40000000-0000-0000-0000-000000000001', null, null, 180, 80, null, 'Admin A');
reset role;
select pg_temp.check(amount = 108 and suggested_amount = 108, 'spec edit at 35% → $108')
  from public.billing_items where id = '40000000-0000-0000-0000-000000000001';
select pg_temp.act(:ADMIN);
set role authenticated;
select markup_override from public.set_billing_item_markup('40000000-0000-0000-0000-000000000001', null, 'Admin A');
select amount from public.update_print_spec('40000000-0000-0000-0000-000000000001', null, null, 180, 80, null, 'Admin A');
reset role;
select pg_temp.check(amount = 112 and markup_override is null, 'Use default → $112')
  from public.billing_items where id = '40000000-0000-0000-0000-000000000001';
-- 2d. a manual Final price survives a spec edit (qty 180 → 200 keeps $774)
select pg_temp.act(:ADMIN);
set role authenticated;
select amount from public.update_print_spec('40000000-0000-0000-0000-000000000003', null, null, 200, null, null, 'Admin A');
reset role;
select pg_temp.check(amount = 774 and quantity = 200, 'manual Final kept by spec edit')
  from public.billing_items where id = '40000000-0000-0000-0000-000000000003';
-- 2e. 8-arg review_print_price (the app's): accepts the new rule, refuses the old, confirms
select pg_temp.act(:PRINTER);
set role authenticated;
select pg_temp.expect_error($q$select public.review_print_price('40000000-0000-0000-0000-0000000000a1', 0.44, 80, 40, false, null, null, 'x')$q$, 'INVALID');
select amount, price_review_status from public.review_print_price('40000000-0000-0000-0000-0000000000a1', 0.33, 60, 40, true, null, null, 'Printing C');
reset role;
select pg_temp.check(amount = 60 and price_review_status = 'CONFIRMED', 'review confirms at $60')
  from public.billing_items where id = '40000000-0000-0000-0000-0000000000a1';
-- 2f. the live authorization of the two app RPCs is kept exactly
select pg_temp.act(:BILLING);
set role authenticated;
select pg_temp.expect_error($q$select public.update_print_spec('40000000-0000-0000-0000-000000000001', null, null, 180, 80, null, 'x')$q$, 'FORBIDDEN');
select pg_temp.expect_error($q$select public.review_print_price('40000000-0000-0000-0000-0000000000a1', 0.33, 60, 40, false, null, null, 'x')$q$, 'FORBIDDEN');
select pg_temp.act(:DESIGN);
select pg_temp.expect_error($q$select public.review_print_price('40000000-0000-0000-0000-0000000000a1', 0.33, 60, 40, false, null, null, 'x')$q$, 'FORBIDDEN');
select amount from public.update_print_spec('40000000-0000-0000-0000-000000000001', null, null, 180, 80, null, 'Designer D');
reset role;
-- 2g. compatibility function keeps its own established semantics
select pg_temp.check(public.round_print_billing_price(40) = 70, 'round_print_billing_price unchanged');
select 'ok 2 insert / 7-arg spec / 8-arg review follow the markup rule; manual Final kept; live auth kept (spec: DESIGNER/PRINTING/ADMIN, review: PRINTING/ADMIN); compatibility unchanged' as result;

-- 3. override_billing_unit_price: every pricing role ------------------------------
select pg_temp.act(:BILLING);
set role authenticated;
select amount, unit_price from public.override_billing_unit_price('40000000-0000-0000-0000-000000000003', 4.30, 860, 'Billing B');
select pg_temp.expect_error($q$select public.override_billing_unit_price('40000000-0000-0000-0000-000000000003', 4.30, 900, 'x')$q$, 'INVALID');
select pg_temp.act(:ACCT);
select amount, unit_price from public.override_billing_unit_price('40000000-0000-0000-0000-000000000003', 4.35, 870, 'Accounting E');
select pg_temp.act(:PRINTER);
select amount, unit_price from public.override_billing_unit_price('40000000-0000-0000-0000-000000000003', 4.30, 860, 'Printing C');
select pg_temp.act(:ADMIN);
select pg_temp.expect_error($q$select public.override_billing_unit_price('40000000-0000-0000-0000-000000000004', 365, 730, 'x')$q$, 'ITEM_LOCKED');
select pg_temp.expect_error($q$select public.override_billing_unit_price('40000000-0000-0000-0000-000000000005', 50, 150, 'x')$q$, 'ITEM_LOCKED');
select pg_temp.expect_error($q$select public.override_billing_unit_price('40000000-0000-0000-0000-000000000006', 1, 100, 'x')$q$, 'HISTORY_READ_ONLY');
reset role;
select pg_temp.check(amount = 860 and unit_price = 4.3 and quantity = 200, 'unit override stored')
  from public.billing_items where id = '40000000-0000-0000-0000-000000000003';
-- the old amount-only override is unchanged and still cannot move unit_price
select pg_temp.act(:BILLING);
set role authenticated;
select amount from public.override_billing_price('40000000-0000-0000-0000-000000000003', 870, 'Billing B');
reset role;
select pg_temp.check(amount = 870 and unit_price = 4.3, 'old override amount-only')
  from public.billing_items where id = '40000000-0000-0000-0000-000000000003';
select 'ok 3 unit price: BILLING/ACCOUNTING/PRINTING/ADMIN, mismatch refused, locks; old override unchanged' as result;

-- 4. guards: direct writes ----------------------------------------------------
select pg_temp.act(:BILLING);
set role authenticated;
select pg_temp.expect_error($q$update public.billing_items set markup_override = 99 where id = '40000000-0000-0000-0000-000000000003'$q$, 'FORBIDDEN');
select pg_temp.expect_error($q$update public.billing_items set margin_override = 0.2 where id = '40000000-0000-0000-0000-000000000003'$q$, 'FORBIDDEN');
select pg_temp.expect_error($q$update public.billing_items set print_cost_amount = 1 where id = '40000000-0000-0000-0000-000000000003'$q$, 'FORBIDDEN');
select pg_temp.expect_error($q$update public.billing_items set print_cost_unit_price = 1 where id = '40000000-0000-0000-0000-000000000003'$q$, 'FORBIDDEN');
select pg_temp.expect_error($q$update public.billing_items set print_cost_confirmed_by = 'x' where id = '40000000-0000-0000-0000-000000000003'$q$, 'FORBIDDEN');
select pg_temp.expect_error($q$update public.billing_items set billing_price_manual = false where id = '40000000-0000-0000-0000-000000000003'$q$, 'FORBIDDEN');
select pg_temp.expect_error($q$update public.billing_items set unit_price = 9 where id = '40000000-0000-0000-0000-000000000003'$q$, 'FORBIDDEN');
select pg_temp.expect_error($q$update public.billing_items set amount = 1 where id = '40000000-0000-0000-0000-000000000003'$q$, 'FORBIDDEN');
-- …while the billing moves BILLING does make still work
update public.billing_items set billing_status = 'NEEDS_REVIEW' where id = '40000000-0000-0000-0000-000000000003';
-- the columns set_project_billing_readiness writes (billing_status, billing_override)
update public.billing_items set billing_status = 'READY_TO_INVOICE', billing_override = true
 where id = '40000000-0000-0000-0000-000000000003';
reset role;
select pg_temp.check(billing_status = 'READY_TO_INVOICE' and billing_override, 'BILLING billing moves still allowed')
  from public.billing_items where id = '40000000-0000-0000-0000-000000000003';
select pg_temp.act(:ACCT);
set role authenticated;
select pg_temp.expect_error($q$update public.billing_items set markup_override = 99 where id = '40000000-0000-0000-0000-000000000003'$q$, 'FORBIDDEN');
select pg_temp.act(:PRINTER);
select pg_temp.expect_error($q$update public.billing_items set markup_override = 99 where id = '40000000-0000-0000-0000-000000000003'$q$, 'FORBIDDEN');
reset role;
select 'ok 4 guards: BILLING direct writes limited to billing_status/billing_override (still allowed); markup & cost basis protected' as result;

-- 5. set_billing_item_markup -----------------------------------------------------
select pg_temp.act(:BILLING);
set role authenticated;
select markup_override from public.set_billing_item_markup('40000000-0000-0000-0000-000000000007', 35, 'Billing B');
select pg_temp.act(:ACCT);
select markup_override from public.set_billing_item_markup('40000000-0000-0000-0000-000000000003', 20, 'Accounting E');
select pg_temp.act(:PRINTER);
select markup_override from public.set_billing_item_markup('40000000-0000-0000-0000-000000000003', 25, 'Printing C');
select pg_temp.act(:DESIGN);
select markup_override from public.set_billing_item_markup('40000000-0000-0000-0000-0000000000a1', 35, 'Designer D');
select markup_override from public.set_billing_item_markup('40000000-0000-0000-0000-0000000000a1', null, 'Designer D');
select pg_temp.expect_error($q$select public.set_billing_item_markup('40000000-0000-0000-0000-000000000004', 35, 'x')$q$, 'ITEM_LOCKED');
select pg_temp.expect_error($q$select public.set_billing_item_markup('40000000-0000-0000-0000-000000000005', 35, 'x')$q$, 'ITEM_LOCKED');
select pg_temp.expect_error($q$select public.set_billing_item_markup('40000000-0000-0000-0000-000000000006', 35, 'x')$q$, 'HISTORY_READ_ONLY');
select pg_temp.expect_error($q$select public.set_billing_item_markup('40000000-0000-0000-0000-000000000003', -1, 'x')$q$, 'INVALID');
select pg_temp.expect_error($q$select public.set_billing_item_markup('40000000-0000-0000-0000-000000000003', 1001, 'x')$q$, 'INVALID');
reset role;
set role anon;
select pg_temp.expect_error($q$select public.set_billing_item_markup('40000000-0000-0000-0000-000000000003', 35, 'x')$q$, 'permission denied');
reset role;
select pg_temp.check(markup_override = 35 and amount = 150, 'markup stored, price untouched')
  from public.billing_items where id = '40000000-0000-0000-0000-000000000007';
select 'ok 5 markup RPC: all pricing roles, NULL clears, locks, range, anon' as result;

-- 6. set_project_deposit ----------------------------------------------------------
select pg_temp.act(:BILLING);
set role authenticated;
select deposit_amount from public.set_project_deposit('20000000-0000-0000-0000-000000000001', 200, 'Billing B');
select deposit_amount from public.set_project_deposit('20000000-0000-0000-0000-000000000001', 700, 'Billing B');
select deposit_amount from public.set_project_deposit('20000000-0000-0000-0000-000000000001', null, 'Billing B');
select deposit_amount from public.set_project_deposit('20000000-0000-0000-0000-000000000002', 150.555, 'Billing B');
select pg_temp.expect_error($q$select public.set_project_deposit('20000000-0000-0000-0000-000000000002', -1, 'x')$q$, 'INVALID');
select pg_temp.expect_error($q$select public.set_project_deposit('20000000-0000-0000-0000-000000000003', 10, 'x')$q$, 'PROJECT_LOCKED');
reset role;
select pg_temp.check(deposit_amount = 150.56, 'deposit rounded to cents') from public.projects where id = '20000000-0000-0000-0000-000000000002';
select pg_temp.act('');
select pg_temp.expect_error($q$update public.projects set deposit_amount = -5 where id = '20000000-0000-0000-0000-000000000002'$q$, 'new row for relation "projects" violates check constraint');
set role anon;
select pg_temp.expect_error($q$select public.set_project_deposit('20000000-0000-0000-0000-000000000002', 1, 'x')$q$, 'permission denied');
reset role;
select 'ok 6 deposit: partial/over/clear, cents, billed project locked, check constraint, anon' as result;

-- 7. service key (pilot mode, how the live preview runs) -----------------------
select pg_temp.act('');
select set_config('request.jwt.claim.role', 'service_role', false);
set role service_role;
select amount, unit_price from public.override_billing_unit_price('40000000-0000-0000-0000-000000000007', 0.32, 160, 'Pilot');
select deposit_amount from public.set_project_deposit('20000000-0000-0000-0000-000000000002', 200, 'Pilot');
select markup_override from public.set_billing_item_markup('40000000-0000-0000-0000-000000000007', null, 'Pilot');
select pg_temp.expect_error($q$select public.override_billing_unit_price('40000000-0000-0000-0000-000000000004', 365, 730, 'Pilot')$q$, 'ITEM_LOCKED');
select pg_temp.expect_error($q$select public.set_billing_item_markup('40000000-0000-0000-0000-000000000005', 1, 'Pilot')$q$, 'ITEM_LOCKED');
reset role;
select set_config('request.jwt.claim.role', '', false);
select 'ok 7 service-role (pilot) path' as result;

-- 8. the print-cost basis and margin_override were never written -----------------
do $$ declare r record; begin
  for r in select b.id, b.basis, pg_temp.cost_basis(b.id) as now_basis from cost_basis_before b loop
    perform pg_temp.check(r.now_basis = r.basis, format('cost basis of %s: %s -> %s', r.id, r.basis, r.now_basis));
  end loop;
end $$;
select 'ok 8 print-cost basis (unit/amount/confirmed) and margin_override untouched by every path' as result;

-- 9. audit trail -------------------------------------------------------------------
select pg_temp.check((select count(*) from public.audit_logs where action = 'billing.markup') >= 8
   and (select count(*) from public.audit_logs where action = 'project.deposit') >= 5, 'audit entries');
select 'ok 9 audit entries written' as result;
