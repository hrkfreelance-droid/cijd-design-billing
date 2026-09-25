#!/bin/bash
# Verifies supabase/migrations/20260925090000_billing_v3_markup_unit_price_deposit.sql
# on a throwaway local Postgres 16 that reproduces the LIVE schema. Never
# connects to Supabase.
#
#   1. fresh cluster + minimal Supabase stubs (auth schema, roles)
#   2. every repository migration BEFORE 20260925090000 (ends 20260909220000)
#   3. the live Sep 12 drift: live-baseline/*.sql (live columns + placeholder
#      functions under the live names), then live-schema/*.sql (the real
#      exported definitions) over them when present
#   4. production-like rows: old-rule prices, manual overrides, invoiced, paid,
#      imported history, print-cost-basis rows (one confirmed)
#   5. fingerprint every row and every schema object → apply the migration →
#      fingerprint again → both diffs must be empty
#   6. the migration refuses a second run and a pre-existing name, changing nothing
#   7. exercise the new functions as ADMIN, BILLING, ACCOUNTING, PRINTING,
#      DESIGNER, anon and service_role
#
# Usage: supabase/tests/billing-v3-pricing/run.sh   (as root; uses the `postgres` OS user)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
WORK="$(mktemp -d /var/tmp/cijd-v3-sql.XXXX)"
PGD="$WORK/data"; PORT="${PG_PORT:-54339}"
MIGRATION=20260925090000_billing_v3_markup_unit_price_deposit.sql
mkdir -p "$PGD" "$WORK/drift"; chown -R postgres "$WORK"; chmod 755 "$WORK"
cp "$HERE"/*.sql "$WORK/"; cp "$ROOT"/supabase/migrations/*.sql "$WORK/"
cp "$HERE"/live-baseline/*.sql "$WORK/drift/"
DRIFT="live-baseline (live columns + placeholder functions)"
if compgen -G "$HERE/live-schema/*.sql" >/dev/null; then
  # Real live definitions replace the placeholders (same signatures).
  for f in "$HERE"/live-schema/*.sql; do cp "$f" "$WORK/drift/zz-$(basename "$f")"; done
  DRIFT="live-baseline columns + live-schema (real exported definitions)"
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
for f in $(cd "$WORK" && ls 0*.sql 2026*.sql | grep -v "$MIGRATION"); do $P -d cijd -f "$WORK/$f" 2>&1 | grep -v NOTICE || true; done
for f in "$WORK"/drift/*.sql; do $P -d cijd -f "$f" 2>&1 | grep -v NOTICE || true; done
echo "ok baseline: repository chain + $DRIFT"
$P -d cijd -f "$WORK/seed-prodlike.sql"

rows() {
  for t in $($Q -c "select schemaname||'.'||tablename from pg_tables where schemaname in ('public','auth') order by 1"); do
    $Q -c "select '$t ' || (to_jsonb(r) - 'deposit_amount' - 'markup_override')::text from $t r order by 1"
  done
}
rows > "$WORK/rows-before.txt"
$Q -f "$WORK/schema-fingerprint.sql" > "$WORK/schema-before.txt"
$Q -f "$WORK/live-snapshot.sql" > "$WORK/live-before.txt"

$P -d cijd -f "$WORK/$MIGRATION" 2>&1 | grep -v NOTICE || true
echo "ok migration applied"

rows > "$WORK/rows-after.txt"
$Q -f "$WORK/schema-fingerprint.sql" > "$WORK/schema-after.txt"
$Q -f "$WORK/live-snapshot.sql" > "$WORK/live-after.txt"
diff "$WORK/rows-before.txt" "$WORK/rows-after.txt"
echo "ok data: no existing row changed ($(wc -l < "$WORK/rows-before.txt") rows, incl. $($Q -c "select count(*) from billing_items where print_cost_amount is not null") print-cost-basis rows)"
diff "$WORK/schema-before.txt" "$WORK/schema-after.txt"
echo "ok schema: no existing object changed ($(wc -l < "$WORK/schema-before.txt") functions/triggers/constraints/policies/columns)"
diff "$WORK/live-before.txt" "$WORK/live-after.txt"
echo "ok live-snapshot.sql: identical before/after"
[ "$($Q -c "select count(*) from projects where deposit_amount is not null")$($Q -c "select count(*) from billing_items where markup_override is not null")" = "00" ]
echo "ok new columns: NULL on every existing row"
[ "$($Q -c "select count(*) from billing_items where margin_override is not null")" = "0" ]
echo "ok margin_override: untouched (still NULL everywhere)"

# A second run must be refused by the preflight and change nothing.
if $P -d cijd -f "$WORK/$MIGRATION" >"$WORK/rerun.log" 2>&1; then echo "second run was NOT refused"; exit 1; fi
grep -q "PREFLIGHT: objects already exist" "$WORK/rerun.log"
$Q -f "$WORK/schema-fingerprint.sql" | diff "$WORK/schema-after.txt" -
echo "ok second run: refused by preflight, nothing changed"

psql -h "$WORK" -p "$PORT" -U postgres -d cijd -q -v ON_ERROR_STOP=1 -f "$WORK/functions-test.sql" 2>&1 | grep -E "^ ok |ERROR"
