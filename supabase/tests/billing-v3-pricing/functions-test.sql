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
-- The print-cost-basis and gross-margin fields of a row, which nothing in this
-- release may write.
create or replace function pg_temp.cost_basis(p_id uuid) returns text language sql as $$
  select jsonb_build_object('pcu', print_cost_unit_price, 'pca', print_cost_amount, 'pcb', print_cost_confirmed_by,
    'pcat', print_cost_confirmed_at, 'pc', print_cost, 'mo', margin_override, 'sa', suggested_amount,
    'su', suggested_unit_price, 'q', quantity)::text
  from public.billing_items where id = p_id $$;
grant execute on all functions in schema pg_temp to authenticated, anon, service_role;
create temp table cost_basis_before as
  select id, pg_temp.cost_basis(id) as basis from public.billing_items;
grant select on cost_basis_before to authenticated, anon, service_role;

-- 1. the markup-on-cost rule in SQL matches the app -------------------------
do $$ declare r record; begin
  for r in select * from (values (40::numeric, null::numeric, 60::numeric), (50, null, 75), (50.01, null, 70.01),
      (80, null, 112), (100, null, 140), (100.01, null, 130.01), (150, null, 195), (645, null, 838.5),
      (40, 35, 54), (80, 35, 108), (150, 0, 150)) v(cost, markup, expected) loop
    if public.print_markup_recommended_amount(r.cost, r.markup) <> r.expected then
      raise exception 'print_markup_recommended_amount(%, %) = %, expected %', r.cost, r.markup,
        public.print_markup_recommended_amount(r.cost, r.markup), r.expected;
    end if;
  end loop;
end $$;
select 'ok 1 markup-on-cost rule (default bands + manual override)' as result;

-- 2. override_billing_unit_price ---------------------------------------------
-- ADMIN: qty 180 → 200 through the existing spec RPC, then $4.30 × 200 = $860
select pg_temp.act('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select amount from public.update_print_spec('40000000-0000-0000-0000-000000000003', null, null, 200, null, null, 'Admin A');
select amount, unit_price from public.override_billing_unit_price('40000000-0000-0000-0000-000000000003', 4.30, 860, 'Admin A');
select pg_temp.expect_error($q$select public.override_billing_unit_price('40000000-0000-0000-0000-000000000003', 4.30, 900, 'x')$q$, 'INVALID');
reset role;
do $$ declare m public.billing_items; begin
  select * into m from public.billing_items where id = '40000000-0000-0000-0000-000000000003';
  if m.amount <> 860 or m.unit_price <> 4.3 or m.quantity <> 200 then raise exception 'unit override: % / % / %', m.amount, m.unit_price, m.quantity; end if;
end $$;
-- PRINTING through its existing guard ('price' action)
select pg_temp.act('00000000-0000-0000-0000-00000000000c');
set role authenticated;
select amount, unit_price from public.override_billing_unit_price('40000000-0000-0000-0000-000000000003', 4.30, 860, 'Printing C');
reset role;
-- BILLING / ACCOUNTING: the existing guard refuses unit_price → FORBIDDEN (the app saves the total alone)
select pg_temp.act('00000000-0000-0000-0000-00000000000b');
set role authenticated;
select pg_temp.expect_error($q$select public.override_billing_unit_price('40000000-0000-0000-0000-000000000003', 4.35, 870, 'x')$q$, 'FORBIDDEN');
select amount, unit_price from public.override_billing_price('40000000-0000-0000-0000-000000000003', 870, 'Billing B');
reset role;
do $$ declare m public.billing_items; begin
  select * into m from public.billing_items where id = '40000000-0000-0000-0000-000000000003';
  if m.amount <> 870 or m.unit_price <> 4.3 then raise exception 'fallback override: % / %', m.amount, m.unit_price; end if;
end $$;
select pg_temp.act('00000000-0000-0000-0000-00000000000e');
set role authenticated;
select pg_temp.expect_error($q$select public.override_billing_unit_price('40000000-0000-0000-0000-000000000003', 4.35, 870, 'x')$q$, 'FORBIDDEN');
-- locks
select pg_temp.act('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error($q$select public.override_billing_unit_price('40000000-0000-0000-0000-000000000004', 365, 730, 'x')$q$, 'ITEM_LOCKED');
select pg_temp.expect_error($q$select public.override_billing_unit_price('40000000-0000-0000-0000-000000000005', 50, 150, 'x')$q$, 'ITEM_LOCKED');
select pg_temp.expect_error($q$select public.override_billing_unit_price('40000000-0000-0000-0000-000000000006', 1, 100, 'x')$q$, 'HISTORY_READ_ONLY');
reset role;
select 'ok 2 unit price override: ADMIN/PRINTING write, BILLING/ACCOUNTING refused (total-only fallback), locks' as result;

-- 3. set_project_deposit ----------------------------------------------------
select pg_temp.act('00000000-0000-0000-0000-00000000000b');
set role authenticated;
select deposit_amount from public.set_project_deposit('20000000-0000-0000-0000-000000000001', 200, 'Billing B');
select deposit_amount from public.set_project_deposit('20000000-0000-0000-0000-000000000001', 700, 'Billing B');
select deposit_amount from public.set_project_deposit('20000000-0000-0000-0000-000000000001', null, 'Billing B');
select deposit_amount from public.set_project_deposit('20000000-0000-0000-0000-000000000002', 150.555, 'Billing B');
select pg_temp.expect_error($q$select public.set_project_deposit('20000000-0000-0000-0000-000000000002', -1, 'x')$q$, 'INVALID');
select pg_temp.expect_error($q$select public.set_project_deposit('20000000-0000-0000-0000-000000000003', 10, 'x')$q$, 'PROJECT_LOCKED');
reset role;
do $$ begin
  if (select deposit_amount from public.projects where id = '20000000-0000-0000-0000-000000000002') <> 150.56 then
    raise exception 'deposit not rounded to cents';
  end if;
end $$;
select pg_temp.act('');
select pg_temp.expect_error($q$update public.projects set deposit_amount = -5 where id = '20000000-0000-0000-0000-000000000002'$q$, 'new row for relation "projects" violates check constraint');
set role anon;
select pg_temp.expect_error($q$select public.set_project_deposit('20000000-0000-0000-0000-000000000002', 1, 'x')$q$, 'permission denied');
reset role;
select 'ok 3 deposit: partial/over/clear, cents, billed project locked, check constraint, anon' as result;

-- 4. set_billing_item_markup ------------------------------------------------
-- BILLING on a delivered, confirmed print-cost-basis line: markup only
select pg_temp.act('00000000-0000-0000-0000-00000000000b');
set role authenticated;
select markup_override from public.set_billing_item_markup('40000000-0000-0000-0000-000000000007', 35, 'Billing B');
reset role;
-- ACCOUNTING (existing guard accepts only the billing-price action)
select pg_temp.act('00000000-0000-0000-0000-00000000000e');
set role authenticated;
select markup_override from public.set_billing_item_markup('40000000-0000-0000-0000-000000000003', 20, 'Accounting E');
reset role;
-- PRINTING, DESIGNER, ADMIN; NULL clears
select pg_temp.act('00000000-0000-0000-0000-00000000000c');
set role authenticated;
select markup_override from public.set_billing_item_markup('40000000-0000-0000-0000-000000000003', 25, 'Printing C');
select pg_temp.act('00000000-0000-0000-0000-00000000000d');
select markup_override from public.set_billing_item_markup('40000000-0000-0000-0000-000000000001', 35, 'Designer D');
select pg_temp.act('00000000-0000-0000-0000-00000000000a');
select markup_override from public.set_billing_item_markup('40000000-0000-0000-0000-000000000001', null, 'Admin A');
-- locks, range, history
select pg_temp.expect_error($q$select public.set_billing_item_markup('40000000-0000-0000-0000-000000000004', 35, 'x')$q$, 'ITEM_LOCKED');
select pg_temp.expect_error($q$select public.set_billing_item_markup('40000000-0000-0000-0000-000000000005', 35, 'x')$q$, 'ITEM_LOCKED');
select pg_temp.expect_error($q$select public.set_billing_item_markup('40000000-0000-0000-0000-000000000006', 35, 'x')$q$, 'HISTORY_READ_ONLY');
select pg_temp.expect_error($q$select public.set_billing_item_markup('40000000-0000-0000-0000-000000000003', -1, 'x')$q$, 'INVALID');
select pg_temp.expect_error($q$select public.set_billing_item_markup('40000000-0000-0000-0000-000000000003', 1001, 'x')$q$, 'INVALID');
reset role;
set role anon;
select pg_temp.expect_error($q$select public.set_billing_item_markup('40000000-0000-0000-0000-000000000003', 35, 'x')$q$, 'permission denied');
reset role;
do $$ declare r record; begin
  select markup_override into r from public.billing_items where id = '40000000-0000-0000-0000-000000000007';
  if r.markup_override <> 35 then raise exception 'markup not stored'; end if;
  if (select markup_override from public.billing_items where id = '40000000-0000-0000-0000-000000000001') is not null then
    raise exception 'NULL did not clear the markup';
  end if;
  if (select amount from public.billing_items where id = '40000000-0000-0000-0000-000000000007') <> 150 then
    raise exception 'markup moved a stored price';
  end if;
end $$;
select 'ok 4 markup: BILLING/ACCOUNTING/PRINTING/DESIGNER/ADMIN, NULL clears, locks, range, anon' as result;

-- 5. service key (pilot mode, how the live preview runs) --------------------
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
select 'ok 5 service-role (pilot) path' as result;

-- 6. the Sep 12 print-cost basis and margin_override were never written -----
do $$ declare r record; begin
  for r in select b.id, b.basis, pg_temp.cost_basis(b.id) as now_basis from cost_basis_before b loop
    -- quantity of item 3 was changed on purpose by the existing spec RPC in step 2
    if r.id = '40000000-0000-0000-0000-000000000003' then
      if (r.now_basis::jsonb - 'q' - 'sa' - 'su') <> (r.basis::jsonb - 'q' - 'sa' - 'su') then
        raise exception 'cost basis changed on %: % -> %', r.id, r.basis, r.now_basis;
      end if;
    elsif r.now_basis <> r.basis then
      raise exception 'cost basis changed on %: % -> %', r.id, r.basis, r.now_basis;
    end if;
  end loop;
end $$;
select 'ok 6 print-cost basis (unit/amount/confirmed) and margin_override untouched by every new RPC' as result;

-- 7. audit trail -------------------------------------------------------------
do $$ begin
  if (select count(*) from public.audit_logs where action = 'billing.markup') < 6
     or (select count(*) from public.audit_logs where action = 'project.deposit') < 5 then
    raise exception 'audit entries missing';
  end if;
end $$;
select 'ok 7 audit entries written' as result;
