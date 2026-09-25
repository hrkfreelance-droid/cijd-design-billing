\set ON_ERROR_STOP 1
-- Test harness only (plain Postgres): role lookup as 0002 defined it, so a
-- signed-in role session does not recurse through the users_read policy.
-- NOT part of the migration.
alter function public.current_role_name() security definer;
-- helpers ------------------------------------------------------------------
create or replace function pg_temp.act(p_sub text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p_sub, false); end $$;
create or replace function pg_temp.expect_error(p_sql text, p_code text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected % but statement succeeded: %', p_code, p_sql;
exception when others then
  if sqlerrm not like p_code || '%' then raise exception 'expected %, got "%" for %', p_code, sqlerrm, p_sql; end if;
end $$;
grant execute on all functions in schema pg_temp to authenticated, anon, service_role;

-- 1. the recommendation in SQL matches the app ------------------------------
do $$ declare r record; begin
  for r in select * from (values (40::numeric,60::numeric),(50,75),(50.01,70.01),(80,112),(100,140),(100.01,130.01),(150,195),(645,838.5)) v(cost, expected) loop
    if public.print_recommended_amount(r.cost) <> r.expected then
      raise exception 'print_recommended_amount(%) = %, expected %', r.cost, public.print_recommended_amount(r.cost), r.expected;
    end if;
  end loop;
end $$;
select 'ok 1 recommendation bands' as result;

-- 2. a new PRINT line is priced with the markup rule (ensure trigger) --------
select pg_temp.act('00000000-0000-0000-0000-00000000000d');  -- DESIGNER
set role authenticated;
insert into public.billing_items (id, project_id, description, type, service_type, quantity, unit_price, amount, print_cost, created_by, updated_by)
values ('40000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-000000000001', 'New flyers', 'PRINT', 'PRINTING', 180, 0, 0, 40, 'Designer D', 'Designer D');
reset role;
do $$ declare i public.billing_items; begin
  select * into i from public.billing_items where id = '40000000-0000-0000-0000-0000000000a1';
  if i.amount <> 60 or i.suggested_amount <> 60 then raise exception 'new line amount %, suggested %', i.amount, i.suggested_amount; end if;
end $$;
select 'ok 2 new line uses markup rule' as result;

-- 3. update_print_spec: auto line follows new rule; manual line keeps its price
select pg_temp.act('00000000-0000-0000-0000-00000000000a');  -- ADMIN
set role authenticated;
select amount, suggested_amount from public.update_print_spec('40000000-0000-0000-0000-000000000001', null, null, 180, 80, null, 'Admin A');
select amount, unit_price, suggested_amount from public.update_print_spec('40000000-0000-0000-0000-000000000003', null, null, 200, 645, null, 'Admin A');
reset role;
do $$ declare a public.billing_items; m public.billing_items; begin
  select * into a from public.billing_items where id = '40000000-0000-0000-0000-000000000001';
  select * into m from public.billing_items where id = '40000000-0000-0000-0000-000000000003';
  if a.amount <> 112 then raise exception 'auto line after spec edit = %', a.amount; end if;
  if m.amount <> 774 or m.unit_price <> 4.3 or m.quantity <> 200 then raise exception 'manual line after qty edit = % / % / %', m.amount, m.unit_price, m.quantity; end if;
end $$;
select 'ok 3 spec edit: auto follows, manual kept' as result;

-- 4. override_billing_unit_price as BILLING: $4.30 × 200 = $860 ------------
select pg_temp.act('00000000-0000-0000-0000-00000000000b');  -- BILLING
set role authenticated;
select amount, unit_price, custom_amount, billing_price_manual from public.override_billing_unit_price('40000000-0000-0000-0000-000000000003', 4.30, 860, 'Billing B');
-- typed-total direction: $55 over qty 3 is not this line, so use a consistent pair on qty 200
select amount, unit_price from public.override_billing_unit_price('40000000-0000-0000-0000-000000000003', 4.33, 865, 'Billing B');
select pg_temp.expect_error($q$select public.override_billing_unit_price('40000000-0000-0000-0000-000000000003', 4.30, 900, 'Billing B')$q$, 'INVALID');
select pg_temp.expect_error($q$select public.override_billing_unit_price('40000000-0000-0000-0000-000000000004', 365, 730, 'Billing B')$q$, 'ITEM_LOCKED');
select pg_temp.expect_error($q$select public.override_billing_unit_price('40000000-0000-0000-0000-000000000005', 50, 150, 'Billing B')$q$, 'ITEM_LOCKED');
select pg_temp.expect_error($q$select public.override_billing_unit_price('40000000-0000-0000-0000-000000000006', 1, 100, 'Billing B')$q$, 'HISTORY_READ_ONLY');
reset role;
select 'ok 4 unit price override + locks' as result;

-- 5. the same as PRINTING (its own guard) ----------------------------------
select pg_temp.act('00000000-0000-0000-0000-00000000000c');  -- PRINTING
set role authenticated;
select amount, unit_price from public.override_billing_unit_price('40000000-0000-0000-0000-000000000003', 4.30, 860, 'Printing C');
reset role;
select 'ok 5 PRINTING guard allows announced unit price' as result;

-- 6. the old amount-only override is unchanged ----------------------------
select pg_temp.act('00000000-0000-0000-0000-00000000000b');
set role authenticated;
select amount, unit_price from public.override_billing_price('40000000-0000-0000-0000-000000000003', 870, 'Billing B');
reset role;
do $$ declare m public.billing_items; begin
  select * into m from public.billing_items where id = '40000000-0000-0000-0000-000000000003';
  if m.amount <> 870 or m.unit_price <> 4.3 then raise exception 'old override changed unit price: % / %', m.amount, m.unit_price; end if;
end $$;
select 'ok 6 old override still amount-only' as result;

-- 7. the unit-price flag does not leak into a later statement ---------------
select pg_temp.act('00000000-0000-0000-0000-00000000000b');
set role authenticated;
select pg_temp.expect_error($q$update public.billing_items set unit_price = 9 where id = '40000000-0000-0000-0000-000000000003'$q$, 'FORBIDDEN');
reset role;
select 'ok 7 direct unit_price write by BILLING refused' as result;

-- 8. set_project_deposit ----------------------------------------------------
select pg_temp.act('00000000-0000-0000-0000-00000000000b');
set role authenticated;
select deposit_amount from public.set_project_deposit('20000000-0000-0000-0000-000000000001', 200, 'Billing B');
select deposit_amount from public.set_project_deposit('20000000-0000-0000-0000-000000000001', 700, 'Billing B');
select deposit_amount from public.set_project_deposit('20000000-0000-0000-0000-000000000001', null, 'Billing B');
select deposit_amount from public.set_project_deposit('20000000-0000-0000-0000-000000000002', 150.555, 'Billing B');
select pg_temp.expect_error($q$select public.set_project_deposit('20000000-0000-0000-0000-000000000002', -1, 'Billing B')$q$, 'INVALID');
select pg_temp.expect_error($q$select public.set_project_deposit('20000000-0000-0000-0000-000000000003', 10, 'Billing B')$q$, 'PROJECT_LOCKED');
reset role;
select pg_temp.expect_error($q$update public.projects set deposit_amount = -5 where id = '20000000-0000-0000-0000-000000000002'$q$, 'new row for relation "projects" violates check constraint');
set role anon;
select pg_temp.expect_error($q$select public.set_project_deposit('20000000-0000-0000-0000-000000000002', 1, 'x')$q$, 'permission denied');
select pg_temp.expect_error($q$select public.override_billing_unit_price('40000000-0000-0000-0000-000000000003', 4.3, 860, 'x')$q$, 'permission denied');
reset role;
select 'ok 8 deposit rpc, lock, constraint, anon' as result;

-- 9. review_print_price: PRE-EXISTING enum-cast error (same on a DB without
--    20260925090000); only its formula line changed, verified by diff.
select pg_temp.act('00000000-0000-0000-0000-00000000000c');
set role authenticated;
select pg_temp.expect_error($q$select public.review_print_price('40000000-0000-0000-0000-0000000000a1', 0.33, 60, 40, false, null, null, 'Printing C')$q$, 'column "price_review_status" is of type');
reset role;
select 'ok 9 review_print_price: pre-existing cast error unchanged' as result;

-- 10. audit trail -----------------------------------------------------------
select action, count(*) from public.audit_logs where action in ('billing.price.override','project.deposit') group by 1 order by 1;

-- 11. the live pilot path: a service-key session (no auth.uid) --------------
select set_config('request.jwt.claim.sub', '', false);
select set_config('request.jwt.claim.role', 'service_role', false);
set role service_role;
select amount, unit_price from public.override_billing_unit_price('40000000-0000-0000-0000-000000000003', 4.30, 860, 'Pilot');
select deposit_amount from public.set_project_deposit('20000000-0000-0000-0000-000000000002', 200, 'Pilot');
select pg_temp.expect_error($q$select public.override_billing_unit_price('40000000-0000-0000-0000-000000000004', 365, 730, 'Pilot')$q$, 'ITEM_LOCKED');
reset role;
select 'ok 11 service-role (pilot) path' as result;
