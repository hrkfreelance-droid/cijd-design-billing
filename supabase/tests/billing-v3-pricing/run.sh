#!/bin/bash
# Verifies the two Billing V3 release migrations on a throwaway local
# Postgres 16 that reproduces the LIVE schema. Never connects to Supabase.
#
#   A = 20260925090000_billing_v3_markup_unit_price_deposit.sql   (additive)
#   B = 20260925100000_billing_v3_align_recommendation_and_guards.sql (alignment)
#
#   1. fresh cluster + minimal Supabase stubs (auth schema, roles)
#   2. the live migration history, in version order: this repository's chain
#      + live-baseline/ (the real 20260902* SQL from integrate-production-
#      workspace, and the 20260912* reconstruction with the exact live
#      signatures) + live-schema/*.sql (real exported definitions) if present
#   3. production-like rows: old-rule prices, manual overrides, invoiced, paid,
#      imported history, print-cost-basis rows (one confirmed)
#   4. A: no row and no existing schema object may change
#   5. B: no row may change; the schema diff must be exactly the functions B
#      declares it replaces
#   6. both refuse a second run and change nothing
#   7. behaviour: recommendation paths, overrides, markup, deposit, guards,
#      locks, per role (ADMIN, BILLING, ACCOUNTING, PRINTING, DESIGNER, anon,
#      service_role), and the print-cost basis is never written
#
# Usage: supabase/tests/billing-v3-pricing/run.sh   (as root; uses the `postgres` OS user)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
WORK="$(mktemp -d /var/tmp/cijd-v3-sql.XXXX)"
PGD="$WORK/data"; PORT="${PG_PORT:-54339}"
A=20260925090000_billing_v3_markup_unit_price_deposit.sql
B=20260925100000_billing_v3_align_recommendation_and_guards.sql
mkdir -p "$PGD" "$WORK/chain"; chown -R postgres "$WORK"; chmod 755 "$WORK"
cp "$HERE"/*.sql "$WORK/"
cp "$ROOT"/supabase/migrations/*.sql "$HERE"/live-baseline/*.sql "$WORK/chain/"
BASE="repository chain + live-baseline (real 20260902*, 20260912* reconstruction)"
if compgen -G "$HERE/live-schema/*.sql" >/dev/null; then
  for f in "$HERE"/live-schema/*.sql; do cp "$f" "$WORK/chain/20260924999999_live_$(basename "$f")"; done
  BASE="$BASE + live-schema (real exported definitions)"
fi
chmod -R a+rX "$WORK"
su postgres -c "$BIN/initdb -D $PGD -A trust -U postgres >/dev/null"
su postgres -c "$BIN/pg_ctl -D $PGD -o '-p $PORT -k $WORK' -l $WORK/log start" >/dev/null
trap 'su postgres -c "$BIN/pg_ctl -D $PGD stop -m fast" >/dev/null; rm -rf "$WORK"' EXIT
sleep 2
P="psql -h $WORK -p $PORT -U postgres -q -v ON_ERROR_STOP=1"
Q="psql -h $WORK -p $PORT -U postgres -d cijd -qAt"
apply() {  # apply a SQL file to cijd; any error stops the harness
  if ! $P -d cijd -o /dev/null -f "$1" >"$WORK/apply.log" 2>&1; then
    echo "FAILED applying $(basename "$1"):"; grep -v NOTICE "$WORK/apply.log"; exit 1
  fi
}
record() {  # record a migration file in supabase_migrations.schema_migrations, as Supabase does
  local f; f="$(basename "$1" .sql)"
  $Q -c "insert into supabase_migrations.schema_migrations (version, name) values ('${f%%_*}', '${f#*_}') on conflict do nothing" >/dev/null
}
state() {  # production-state.sql, forced read-only
  PGOPTIONS='-c default_transaction_read_only=on' $Q -f "$WORK/production-state.sql" > "$1"
}
$P -c "create database cijd"
$P -d cijd -f "$WORK/supabase-stubs.sql"
for f in $(ls "$WORK/chain" | grep -v -e "^$A" -e "^$B" | sort); do apply "$WORK/chain/$f"; [[ "$f" == 2026* || "$f" == 0* ]] && record "$f"; done
echo "ok baseline: $BASE"
apply "$WORK/seed-prodlike.sql"

rows() {
  for t in $($Q -c "select schemaname||'.'||tablename from pg_tables where schemaname in ('public','auth') order by 1"); do
    $Q -c "select '$t ' || (to_jsonb(r) - 'deposit_amount' - 'markup_override')::text from $t r order by 1"
  done
}
state "$WORK/state-0.txt"
rows > "$WORK/rows-0.txt"
$Q -f "$WORK/schema-fingerprint.sql" > "$WORK/schema-0.txt"
$Q -f "$WORK/live-snapshot.sql" > "$WORK/live-0.txt"

# ---- A --------------------------------------------------------------------
apply "$WORK/chain/$A"; record "$A"
rows > "$WORK/rows-A.txt"
$Q -f "$WORK/schema-fingerprint.sql" > "$WORK/schema-A.txt"
diff "$WORK/rows-0.txt" "$WORK/rows-A.txt"
diff "$WORK/schema-0.txt" "$WORK/schema-A.txt"
echo "ok A: no existing row ($(wc -l < "$WORK/rows-0.txt")) or schema object ($(wc -l < "$WORK/schema-0.txt")) changed"
[ "$($Q -c "select count(*) from projects where deposit_amount is not null")$($Q -c "select count(*) from billing_items where markup_override is not null")" = "00" ]
echo "ok A: new columns NULL on every existing row"

# ---- B as committed: the gate ------------------------------------------------
# The live 7-arg update_print_spec / 8-arg review_print_price bodies are only
# reconstructed here (see live-baseline/20260924000000_live_app_rpc_bodies.sql),
# so the committed B, which carries the ACTUAL live hashes, must refuse them —
# and name exactly those two: the other five expected hashes match.
gate() {  # $1 = migration file, $2 = log
  $P -c "drop database if exists cijd_gate" >/dev/null
  $P -c "create database cijd_gate template cijd"
  $QG -f "$WORK/schema-fingerprint-all.sql" > "$WORK/gate-before.txt"
  if $P -d cijd_gate -f "$1" >"$2" 2>&1; then echo "$1 was NOT refused"; exit 1; fi
  $QG -f "$WORK/schema-fingerprint-all.sql" | diff "$WORK/gate-before.txt" -
  $P -c "drop database cijd_gate"
}
QG="psql -h $WORK -p $PORT -U postgres -d cijd_gate -qAt"
gate "$WORK/chain/$B" "$WORK/gate.log"
grep -q "PREFLIGHT: live definitions differ" "$WORK/gate.log"
grep -o "public\.[a-z_]*([a-z,]*)" "$WORK/gate.log" | sort -u > "$WORK/gate-names.txt"
printf '%s\n' "public.review_print_price(uuid,numeric,numeric,numeric,boolean,text,text,text)" \
  "public.update_print_spec(uuid,text,text,numeric,numeric,text,text)" | diff - "$WORK/gate-names.txt"
echo "ok B gate: committed B refuses the non-live reconstruction, naming only the 2 app RPCs; nothing changed"

# The previous alignment (62e56f8) expected the repository bodies; its hash
# table does not contain the actual live hashes, so it aborts on live.
OLD_B="$WORK/B-62e56f8.sql"
git -C "$ROOT" show 62e56f8:supabase/migrations/$B > "$OLD_B"
for h in bbbf6b4ac9c725e774a54c8e9db2d4a5 7aba03d0e45011bfb47f419714d23e93; do
  grep -q "$h" "$OLD_B" && { echo "old B unexpectedly expects $h"; exit 1; }
  grep -q "$h" "$WORK/chain/$B" || { echo "committed B does not expect live hash $h"; exit 1; }
done
grep -q 77cef03f754f1fa50a23164c90080f8f "$OLD_B" && grep -q 52a1ed7e4a7f94f6be559dc3a02a73c2 "$OLD_B"
gate "$OLD_B" "$WORK/gate-old.log"
grep -q "PREFLIGHT: live definitions differ" "$WORK/gate-old.log"
echo "ok old B (62e56f8): expects 77cef03f…/52a1ed7e…, not the live bbbf6b4a…/7aba03d0… — aborts, nothing changed"

# ---- B with the two expected hashes swapped for the reconstruction's -------
SPEC_MD5=$($Q -c "select md5(prosrc) from pg_proc where oid = to_regprocedure('public.update_print_spec(uuid,text,text,numeric,numeric,text,text)')")
REVIEW_MD5=$($Q -c "select md5(prosrc) from pg_proc where oid = to_regprocedure('public.review_print_price(uuid,numeric,numeric,numeric,boolean,text,text,text)')")
BH="$WORK/B-harness.sql"
sed -e "s/bbbf6b4ac9c725e774a54c8e9db2d4a5/$SPEC_MD5/" -e "s/7aba03d0e45011bfb47f419714d23e93/$REVIEW_MD5/" "$WORK/chain/$B" > "$BH"
[ "$(diff "$WORK/chain/$B" "$BH" | grep -c '^>')" = "2" ]
chmod a+r "$BH"

# ---- B refuses a live body it was not written against -----------------------
$P -c "create database cijd_drift template cijd"
QD="psql -h $WORK -p $PORT -U postgres -d cijd_drift -qAt"
$P -d cijd_drift -c "create or replace function public.guard_office_billing_item_update() returns trigger language plpgsql security definer set search_path = public as \$\$ begin return new; end \$\$"
$QD -f "$WORK/schema-fingerprint-all.sql" > "$WORK/drift-before.txt"
if $P -d cijd_drift -f "$BH" >"$WORK/drift.log" 2>&1; then echo "B applied over an unexpected body"; exit 1; fi
grep -q "PREFLIGHT: live definitions differ" "$WORK/drift.log"
$QD -f "$WORK/schema-fingerprint-all.sql" | diff "$WORK/drift-before.txt" -
$P -c "drop database cijd_drift"
echo "ok B preflight: an unexpected live body aborts B with nothing changed"

# ---- B --------------------------------------------------------------------
$Q -f "$WORK/schema-fingerprint-all.sql" > "$WORK/schemaall-A.txt"
$Q -c "create schema harness; create table harness.src_before as select p.oid::regprocedure::text as sig, p.prosrc from pg_proc p where p.oid in (to_regprocedure('public.update_print_spec(uuid,text,text,numeric,numeric,text,text)'), to_regprocedure('public.review_print_price(uuid,numeric,numeric,numeric,boolean,text,text,text)'))"
apply "$BH"; record "$B"
# The two live-derived bodies are exactly the old ones with the intended replacements.
[ "$($Q <<'SQL'
select count(*) from harness.src_before b join pg_proc p on p.oid = to_regprocedure(b.sig)
 where p.prosrc = case b.sig
   when 'update_print_spec(uuid,text,text,numeric,numeric,text,text)' then
     replace(b.prosrc,
       'ceil((next_cost / (1 - case when next_cost <= 50 then 0.5 when next_cost <= 100 then 0.4 else 0.3 end) - 0.000000001) / 5) * 5',
       'public.print_markup_recommended_amount(next_cost, item.markup_override)')
   else
     replace(replace(b.prosrc,
       'ceil((p_print_cost / (1 - case when p_print_cost <= 50 then 0.5 when p_print_cost <= 100 then 0.4 else 0.3 end) - 0.000000001) / 5) * 5',
       'public.print_markup_recommended_amount(p_print_cost, item.markup_override)'),
       'price_review_status = case when coalesce(p_confirm, false) then ''CONFIRMED'' else ''REVIEW_REQUIRED'' end,',
       'price_review_status = (case when coalesce(p_confirm, false) then ''CONFIRMED'' else ''REVIEW_REQUIRED'' end)::public.price_review_status,')
 end
   and b.prosrc <> p.prosrc
SQL
)" = "2" ]
$Q -c "select position('current_role_name() not in (''DESIGNER'', ''PRINTING'', ''ADMIN'')' in prosrc) > 0 and position('service_role' in prosrc) = 0 from pg_proc where oid = to_regprocedure('public.update_print_spec(uuid,text,text,numeric,numeric,text,text)')" | grep -qx t
$Q -c "select position('current_role_name() not in (''PRINTING'', ''ADMIN'')' in prosrc) > 0 and position('service_role' in prosrc) = 0 from pg_proc where oid = to_regprocedure('public.review_print_price(uuid,numeric,numeric,numeric,boolean,text,text,text)')" | grep -qx t
$Q -c "drop schema harness cascade" 2>/dev/null
echo "ok B: update_print_spec / review_print_price = live body + only the intended replacements; live authorization kept, no service-role branch added"
rows > "$WORK/rows-B.txt"
$Q -f "$WORK/schema-fingerprint-all.sql" > "$WORK/schemaall-B.txt"
diff "$WORK/rows-0.txt" "$WORK/rows-B.txt"
echo "ok B: no existing row changed"
diff "$WORK/schemaall-A.txt" "$WORK/schemaall-B.txt" | grep '^>' | sed 's/^> //; s/|.*//' | sort > "$WORK/changed.txt" || true
cat > "$WORK/expected-changed.txt" <<'LIST'
function ensure_print_price_review()
function guard_office_billing_item_update()
function guard_printing_billing_item_update()
function override_billing_unit_price(uuid,numeric,numeric,text)
function review_print_price(uuid,numeric,numeric,numeric,boolean,text,text,text)
function set_billing_item_markup(uuid,numeric,text)
function update_print_spec(uuid,text,text,numeric,numeric,text,text)
LIST
diff "$WORK/expected-changed.txt" "$WORK/changed.txt"
[ "$(diff "$WORK/schemaall-A.txt" "$WORK/schemaall-B.txt" | grep -c '^<')" = "7" ]
echo "ok B: schema diff is exactly the 7 declared functions; every other object ($(( $(wc -l < "$WORK/schemaall-A.txt") - 7 ))) identical"
$Q -f "$WORK/live-snapshot.sql" > "$WORK/live-B.txt"
diff "$WORK/live-0.txt" "$WORK/live-B.txt"
echo "ok live-snapshot.sql: identical before A / after B"

# ---- production-state.sql: read-only, no row contents -------------------------
state "$WORK/state-B.txt"
grep -q "^5 functions|ensure_print_price_review()|definer | a92956468b75b1bb2e87652dfe28eaf8 | expected a92956468b75b1bb2e87652dfe28eaf8 → MATCH" "$WORK/state-0.txt"
grep -q "^1 migrations|20260925100000|" "$WORK/state-B.txt"
grep -q "^7 non-null|billing_items.print_cost_amount|4$" "$WORK/state-B.txt"
grep -q "^7 non-null|billing_items.markup_override|0$" "$WORK/state-0.txt"
grep -q "^7 non-null|projects.deposit_amount|0$" "$WORK/state-B.txt"
[ "$(grep '^9 fingerprint' "$WORK/state-0.txt")" = "$(grep '^9 fingerprint' "$WORK/state-B.txt")" ]
if grep -i -E "Admin A|Billing B|Printing C|Designer D|Accounting E|Hiroki|Ringer|Flyers|Posters|Banners|slip-1|INV-001|@" "$WORK/state-0.txt" "$WORK/state-B.txt"; then
  echo "production-state.sql leaked row content"; exit 1
fi
echo "ok production-state.sql: runs read-only before and after, $(wc -l < "$WORK/state-B.txt") facts, no row contents, data fingerprints identical"

# ---- re-runs are refused and change nothing ------------------------------
for M in "$WORK/chain/$A" "$BH"; do
  if $P -d cijd -f "$M" >"$WORK/rerun.log" 2>&1; then echo "second run of $M was NOT refused"; exit 1; fi
  grep -q "PREFLIGHT" "$WORK/rerun.log"
done
$Q -f "$WORK/schema-fingerprint-all.sql" | diff "$WORK/schemaall-B.txt" -
rows | diff "$WORK/rows-B.txt" -
echo "ok re-runs: A and B both refused by their preflight, nothing changed"

psql -h "$WORK" -p "$PORT" -U postgres -d cijd -q -v ON_ERROR_STOP=1 -f "$WORK/functions-test.sql" 2>&1 | grep -E "^ ok |ERROR|CONTEXT|PL/pgSQL"
