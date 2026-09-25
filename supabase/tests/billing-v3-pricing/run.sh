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
$P -c "create database cijd"
$P -d cijd -f "$WORK/supabase-stubs.sql"
for f in $(ls "$WORK/chain" | grep -v -e "^$A" -e "^$B" | sort); do $P -d cijd -f "$WORK/chain/$f" 2>&1 | grep -v NOTICE || true; done
echo "ok baseline: $BASE"
$P -d cijd -f "$WORK/seed-prodlike.sql"

rows() {
  for t in $($Q -c "select schemaname||'.'||tablename from pg_tables where schemaname in ('public','auth') order by 1"); do
    $Q -c "select '$t ' || (to_jsonb(r) - 'deposit_amount' - 'markup_override')::text from $t r order by 1"
  done
}
rows > "$WORK/rows-0.txt"
$Q -f "$WORK/schema-fingerprint.sql" > "$WORK/schema-0.txt"
$Q -f "$WORK/live-snapshot.sql" > "$WORK/live-0.txt"

# ---- A --------------------------------------------------------------------
$P -d cijd -f "$WORK/chain/$A" 2>&1 | grep -v NOTICE || true
rows > "$WORK/rows-A.txt"
$Q -f "$WORK/schema-fingerprint.sql" > "$WORK/schema-A.txt"
diff "$WORK/rows-0.txt" "$WORK/rows-A.txt"
diff "$WORK/schema-0.txt" "$WORK/schema-A.txt"
echo "ok A: no existing row ($(wc -l < "$WORK/rows-0.txt")) or schema object ($(wc -l < "$WORK/schema-0.txt")) changed"
[ "$($Q -c "select count(*) from projects where deposit_amount is not null")$($Q -c "select count(*) from billing_items where markup_override is not null")" = "00" ]
echo "ok A: new columns NULL on every existing row"

# ---- B refuses a live body it was not written against -----------------------
$P -c "create database cijd_drift template cijd"
QD="psql -h $WORK -p $PORT -U postgres -d cijd_drift -qAt"
$P -d cijd_drift -c "create or replace function public.update_print_spec(p_item_id uuid, p_description text, p_print_size text, p_quantity numeric, p_print_cost numeric, p_note text, p_actor text) returns public.billing_items language plpgsql security invoker set search_path = public as \$\$ declare item public.billing_items; begin return item; end \$\$"
$QD -f "$WORK/schema-fingerprint-all.sql" > "$WORK/drift-before.txt"
if $P -d cijd_drift -f "$WORK/chain/$B" >"$WORK/drift.log" 2>&1; then echo "B applied over an unexpected body"; exit 1; fi
grep -q "PREFLIGHT: live definitions differ" "$WORK/drift.log"
$QD -f "$WORK/schema-fingerprint-all.sql" | diff "$WORK/drift-before.txt" -
$P -c "drop database cijd_drift"
echo "ok B preflight: an unexpected live body aborts B with nothing changed"

# ---- B --------------------------------------------------------------------
$Q -f "$WORK/schema-fingerprint-all.sql" > "$WORK/schemaall-A.txt"
$P -d cijd -f "$WORK/chain/$B" 2>&1 | grep -v NOTICE || true
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

# ---- re-runs are refused and change nothing ------------------------------
for M in "$A" "$B"; do
  if $P -d cijd -f "$WORK/chain/$M" >"$WORK/rerun.log" 2>&1; then echo "second run of $M was NOT refused"; exit 1; fi
  grep -q "PREFLIGHT" "$WORK/rerun.log"
done
$Q -f "$WORK/schema-fingerprint-all.sql" | diff "$WORK/schemaall-B.txt" -
rows | diff "$WORK/rows-B.txt" -
echo "ok re-runs: A and B both refused by their preflight, nothing changed"

psql -h "$WORK" -p "$PORT" -U postgres -d cijd -q -v ON_ERROR_STOP=1 -f "$WORK/functions-test.sql" 2>&1 | grep -E "^ ok |ERROR|CONTEXT|PL/pgSQL"
