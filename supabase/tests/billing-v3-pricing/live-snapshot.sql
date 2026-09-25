-- READ-ONLY fingerprint of the live data, for the migration step.
--
-- Run in the Supabase SQL editor BEFORE applying
-- 20260925090000_billing_v3_markup_unit_price_deposit.sql, save the result,
-- apply the migration, run it again, and compare: every row must match.
-- The only column the migration adds, projects.deposit_amount, is left out of
-- the fingerprint so an unchanged row compares equal.
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
       md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id::text), ''))
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
