-- READ-ONLY export of the live definitions this release depends on.
-- Run in the Supabase SQL editor; it changes nothing.
--
-- Result 1 — the exact live function definitions (every overload), as
-- executable "CREATE OR REPLACE FUNCTION" text. Save the `definition` column,
-- one per line block, as supabase/tests/billing-v3-pricing/live-schema/functions.sql:
-- the harness then tests against the real live bodies instead of placeholders,
-- and the follow-up recommendation-rule migration is written from them.
select p.oid::regprocedure::text as signature,
       pg_get_functiondef(p.oid) || ';' as definition
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in (
     'update_print_spec', 'review_print_price', 'update_print_spec_with_margin',
     'review_print_price_with_margin', 'round_print_billing_price', 'ensure_print_price_review',
     'maintain_print_price_review', 'guard_office_billing_item_update',
     'guard_printing_billing_item_update', 'override_billing_price', 'current_role_name')
 order by 1;

-- Result 2 — triggers on billing_items (which functions actually fire).
select tgname, pg_get_triggerdef(t.oid) as definition
  from pg_trigger t
 where t.tgrelid = 'public.billing_items'::regclass and not t.tgisinternal
 order by 1;

-- Result 3 — the SQL of the Sep 12 migrations as recorded by Supabase.
select version, name, array_to_string(statements, E';\n') as sql
  from supabase_migrations.schema_migrations
 where version like '20260912%'
 order by version;
