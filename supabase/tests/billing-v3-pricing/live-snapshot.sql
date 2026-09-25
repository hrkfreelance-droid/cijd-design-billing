-- READ-ONLY fingerprint of the live data, for the migration step.
--
-- Run in the Supabase SQL editor BEFORE applying
-- 20260925090000_billing_v3_markup_unit_price_deposit.sql, save the result,
-- apply the migration, run it again, and compare: every row must match.
-- The two columns the migration adds (projects.deposit_amount,
-- billing_items.markup_override) are left out of the fingerprint so an
-- unchanged row compares equal; the last query checks they are all NULL.
-- This file contains SELECTs only; it changes nothing.
select 'clients' as table_name, count(*) as row_count,
       md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id::text), '')) as fingerprint
  from public.clients t
union all
select 'projects', count(*),
       md5(coalesce(string_agg((to_jsonb(t) - 'deposit_amount')::text, '|' order by t.id::text), ''))
  from public.projects t
union all
select 'billing_items', count(*),
       md5(coalesce(string_agg((to_jsonb(t) - 'markup_override')::text, '|' order by t.id::text), ''))
  from public.billing_items t
union all
select 'invoices', count(*),
       md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id::text), ''))
  from public.invoices t
union all
select 'invoice_items', count(*),
       md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t::text), ''))
  from public.invoice_items t
union all
select 'payments', count(*),
       md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id::text), ''))
  from public.payments t
union all
select 'service_types', count(*),
       md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id::text), ''))
  from public.service_types t
union all
select 'users', count(*),
       md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id::text), ''))
  from public.users t
union all
select 'audit_logs', count(*),
       md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id::text), ''))
  from public.audit_logs t
order by 1;

-- After the migration only: both new columns must be NULL on every existing
-- row (before it, these columns do not exist and this query errors — expected).
-- select (select count(*) from public.projects where deposit_amount is not null) as projects_with_deposit,
--        (select count(*) from public.billing_items where markup_override is not null) as items_with_markup;
