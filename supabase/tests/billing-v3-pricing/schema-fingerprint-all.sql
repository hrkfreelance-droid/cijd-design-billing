-- READ-ONLY. Same as schema-fingerprint.sql but with every object, including
-- the ones 20260925090000 creates — used to compare around 20260925100000,
-- whose diff must list exactly the functions it declares it replaces.
with new_objects as (
  select unnest(array[]::text[]) as name
)
select * from (
  select 'function ' || p.oid::regprocedure::text as object,
         md5(pg_get_functiondef(p.oid) || coalesce(p.proacl::text, '')) as fingerprint
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and p.proname not in (select name from new_objects)
  union all
  select 'trigger ' || c.relname || '.' || t.tgname, md5(pg_get_triggerdef(t.oid))
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and not t.tgisinternal
  union all
  select 'constraint ' || c.relname || '.' || k.conname, md5(pg_get_constraintdef(k.oid))
    from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
  union all
  select 'policy ' || tablename || '.' || policyname,
         md5(coalesce(cmd, '') || coalesce(array_to_string(roles, ','), '') || coalesce(qual, '') || coalesce(with_check, ''))
    from pg_policies where schemaname = 'public'
  union all
  select 'column ' || table_name || '.' || column_name,
         md5(data_type || coalesce(numeric_precision::text, '') || coalesce(numeric_scale::text, '')
             || is_nullable || coalesce(column_default, ''))
    from information_schema.columns
   where table_schema = 'public'
) objects
order by object;
