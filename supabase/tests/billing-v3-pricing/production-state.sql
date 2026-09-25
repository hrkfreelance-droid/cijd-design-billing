-- READ ONLY — SAFE FOR PRODUCTION INSPECTION
--
-- One SELECT statement. It reads catalog metadata, counts and hashes only:
-- no row contents, no names, no e-mails, no credentials, no secrets.
-- It never writes; it also runs unchanged inside a read-only transaction
-- (`begin transaction read only; <this query>; rollback;`).
--
-- Works before and after the 2026-09-25 migrations: columns that may not exist
-- yet (deposit_amount, markup_override) are read through to_jsonb, never by name.
--
-- Output: one row per fact — (section, item, value). Sections:
--   1 migrations          latest applied versions (supabase_migrations.schema_migrations)
--   2 columns             billing_items / projects columns and types
--   3 constraints         pricing-related constraints (definition md5)
--   4 triggers            triggers on billing_items
--   5 functions           signature → security | md5(prosrc) | expected-hash verdict
--   6 row counts          per table
--   7 non-null counts     pricing / cost-basis / deposit columns
--   8 status counts       billing_status / price_review_status distributions
--   9 data fingerprints   md5 per table (new columns excluded; same as live-snapshot.sql)
-- See docs/CIJD_BILLING_PRODUCTION.md.

with
expected(signature, body_md5, note) as (values
  -- Verified read-only against production on 2026-09-25, BEFORE 20260925090000/100000.
  ('ensure_print_price_review()', 'a92956468b75b1bb2e87652dfe28eaf8', 'pre-Sep25 live (= repo 20260909120000)'),
  ('guard_office_billing_item_update()', '3e61115d792b25b6ac3fae259a96c4c3', 'pre-Sep25 live (= repo 20260909120000)'),
  ('guard_printing_billing_item_update()', '5f9eea98caf5587be12aaf3e61d95dbb', 'pre-Sep25 live (= repo 20260909190000)'),
  ('update_print_spec(uuid,text,text,numeric,numeric,text,text)', 'bbbf6b4ac9c725e774a54c8e9db2d4a5', 'pre-Sep25 live (NOT the repo copy)'),
  ('review_print_price(uuid,numeric,numeric,numeric,boolean,text,text,text)', '7aba03d0e45011bfb47f419714d23e93', 'pre-Sep25 live (NOT the repo copy)'),
  -- Created by 20260925090000; replaced by 20260925100000.
  ('override_billing_unit_price(uuid,numeric,numeric,text)', '281dc6b30d39d5f3b440d2126d21d4b9', 'after 20260925090000, before 20260925100000'),
  ('set_billing_item_markup(uuid,numeric,text)', 'f91254314ab1fc2d54bf3f4eb8cca941', 'after 20260925090000, before 20260925100000')
),
watched(name) as (values
  ('ensure_print_price_review'), ('maintain_print_price_review'),
  ('guard_office_billing_item_update'), ('guard_printing_billing_item_update'),
  ('update_print_spec'), ('review_print_price'), ('override_billing_price'), ('set_billing_price'),
  ('round_print_billing_price'), ('update_print_spec_with_margin'), ('review_print_price_with_margin'),
  ('update_print_spec_with_costs'), ('print_markup_recommended_amount'), ('override_billing_unit_price'),
  ('set_billing_item_markup'), ('set_project_deposit'), ('set_item_delivery'), ('set_project_delivery'),
  ('set_item_completion'), ('set_project_billing_readiness'), ('create_invoice'), ('void_invoice'),
  ('confirm_payment'), ('revert_payment'), ('current_role_name')
),
facts(section, item, value) as (
  -- 1 migrations
  select '1 migrations', m.version, coalesce(m.name, '')
    from (select version, name from supabase_migrations.schema_migrations
           order by version desc limit 40) m
  union all
  -- 2 columns
  select '2 columns', c.table_name || '.' || c.column_name,
         c.data_type
           || coalesce('(' || c.numeric_precision || ',' || c.numeric_scale || ')', '')
           || case when c.is_nullable = 'YES' then ' null' else ' not null' end
           || coalesce(' default ' || c.column_default, '')
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name in ('billing_items', 'projects')
  union all
  -- 3 constraints
  select '3 constraints', rel.relname || '.' || k.conname, md5(pg_get_constraintdef(k.oid))
    from pg_constraint k join pg_class rel on rel.oid = k.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
   where n.nspname = 'public' and rel.relname in ('billing_items', 'projects')
  union all
  -- 4 triggers
  select '4 triggers', t.tgname,
         case when t.tgtype & 2 = 2 then 'BEFORE ' else 'AFTER ' end
           || case when t.tgtype & 4 = 4 then 'INSERT ' else '' end
           || case when t.tgtype & 8 = 8 then 'DELETE ' else '' end
           || case when t.tgtype & 16 = 16 then 'UPDATE ' else '' end
           || '→ ' || t.tgfoid::regproc::text
    from pg_trigger t
   where t.tgrelid = 'public.billing_items'::regclass and not t.tgisinternal
  union all
  -- 5 functions
  select '5 functions', p.oid::regprocedure::text,
         case when p.prosecdef then 'definer' else 'invoker' end
           || ' | ' || md5(p.prosrc)
           || coalesce(' | expected ' || e.body_md5 || ' → '
                || case when md5(p.prosrc) = e.body_md5 then 'MATCH' else 'DIFFERENT' end
                || ' (' || e.note || ')', '')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    left join expected e on e.signature = p.oid::regprocedure::text
   where n.nspname = 'public' and p.proname in (select name from watched)
  union all
  -- 6 row counts
  select '6 row counts', 'clients', count(*)::text from public.clients
  union all select '6 row counts', 'projects', count(*)::text from public.projects
  union all select '6 row counts', 'billing_items', count(*)::text from public.billing_items
  union all select '6 row counts', 'invoices', count(*)::text from public.invoices
  union all select '6 row counts', 'invoice_items', count(*)::text from public.invoice_items
  union all select '6 row counts', 'payments', count(*)::text from public.payments
  union all select '6 row counts', 'users', count(*)::text from public.users
  union all select '6 row counts', 'audit_logs', count(*)::text from public.audit_logs
  union all
  -- 7 non-null counts
  select '7 non-null', 'billing_items.' || col,
         (select count(*) from public.billing_items b where to_jsonb(b) ->> col is not null)::text
    from unnest(array['margin_override', 'markup_override', 'print_cost', 'print_cost_unit_price',
                      'print_cost_amount', 'print_cost_confirmed_at', 'billing_price_manual']) col
  union all
  select '7 non-null', 'billing_items.billing_price_manual=true',
         (select count(*) from public.billing_items b where (to_jsonb(b) ->> 'billing_price_manual') = 'true')::text
  union all
  select '7 non-null', 'projects.deposit_amount',
         (select count(*) from public.projects p where to_jsonb(p) ->> 'deposit_amount' is not null)::text
  union all
  -- 8 status counts
  select '8 status', 'billing_status=' || billing_status::text, count(*)::text
    from public.billing_items group by billing_status
  union all
  select '8 status', 'price_review_status=' || coalesce(price_review_status::text, 'NULL'), count(*)::text
    from public.billing_items group by price_review_status
  union all
  select '8 status', 'imported (created_by=import)', count(*)::text
    from public.billing_items where lower(btrim(created_by)) = 'import'
  union all
  -- 9 data fingerprints (identical to live-snapshot.sql)
  select '9 fingerprint', 'clients',
         md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id::text), '')) from public.clients t
  union all select '9 fingerprint', 'projects',
         md5(coalesce(string_agg((to_jsonb(t) - 'deposit_amount')::text, '|' order by t.id::text), '')) from public.projects t
  union all select '9 fingerprint', 'billing_items',
         md5(coalesce(string_agg((to_jsonb(t) - 'markup_override')::text, '|' order by t.id::text), '')) from public.billing_items t
  union all select '9 fingerprint', 'invoices',
         md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id::text), '')) from public.invoices t
  union all select '9 fingerprint', 'invoice_items',
         md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t::text), '')) from public.invoice_items t
  union all select '9 fingerprint', 'payments',
         md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id::text), '')) from public.payments t
)
select section, item, value from facts order by section, item;
