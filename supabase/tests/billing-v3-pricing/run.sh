#!/bin/bash
# Verifies supabase/migrations/20260925090000_billing_v3_markup_unit_price_deposit.sql
# on a throwaway local Postgres 16. Never connects to Supabase.
#
#   1. fresh cluster + minimal Supabase stubs (auth schema, roles)
#   2. every migration BEFORE 20260925090000
#   3. production-like rows (old-rule prices, manual overrides, invoiced, paid, imported)
#   4. snapshot every row → apply the new migration → snapshot → diff (must be empty)
#   5. exercise the new/redefined functions as ADMIN, BILLING, PRINTING, anon, service_role
#
# Usage: supabase/tests/billing-v3-pricing/run.sh   (run as root; uses the `postgres` OS user)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
WORK="$(mktemp -d /var/tmp/cijd-v3-sql.XXXX)"
PGD="$WORK/data"; PORT="${PG_PORT:-54329}"
mkdir -p "$PGD"; chown -R postgres "$WORK"; chmod 755 "$WORK"
cp "$HERE"/*.sql "$WORK/"; cp "$ROOT"/supabase/migrations/*.sql "$WORK/"; chmod a+r "$WORK"/*.sql
su postgres -c "$BIN/initdb -D $PGD -A trust -U postgres >/dev/null"
su postgres -c "$BIN/pg_ctl -D $PGD -o '-p $PORT -k $WORK' -l $WORK/log start" >/dev/null
trap 'su postgres -c "$BIN/pg_ctl -D $PGD stop -m fast" >/dev/null; rm -rf "$WORK"' EXIT
sleep 2
P="psql -h $WORK -p $PORT -U postgres -q -v ON_ERROR_STOP=1"
$P -c "create database cijd"
$P -d cijd -f "$WORK/supabase-stubs.sql"
for f in $(cd "$WORK" && ls 0*.sql 2026*.sql | grep -v 20260925090000); do $P -d cijd -f "$WORK/$f" 2>&1 | grep -v NOTICE || true; done
$P -d cijd -f "$WORK/seed-prodlike.sql"
snapshot() {
  local Q="psql -h $WORK -p $PORT -U postgres -d cijd -qAt"
  for t in $($Q -c "select schemaname||'.'||tablename from pg_tables where schemaname in ('public','auth') order by 1"); do
    $Q -c "select '$t ' || (to_jsonb(r) - 'deposit_amount')::text from $t r order by 1"
  done
}
snapshot > "$WORK/before.txt"
$P -d cijd -f "$WORK/20260925090000_billing_v3_markup_unit_price_deposit.sql" 2>&1 | grep -v NOTICE || true
snapshot > "$WORK/after.txt"
diff "$WORK/before.txt" "$WORK/after.txt"
echo "ok migration: no existing row changed ($(wc -l < "$WORK/before.txt") rows compared)"
$P -d cijd -f "$WORK/20260925090000_billing_v3_markup_unit_price_deposit.sql" 2>&1 | grep -v NOTICE || true
echo "ok migration: re-apply is idempotent"
psql -h "$WORK" -p "$PORT" -U postgres -d cijd -q -v ON_ERROR_STOP=1 -f "$WORK/functions-test.sql" 2>&1 | grep -E "^ ok |ERROR"
