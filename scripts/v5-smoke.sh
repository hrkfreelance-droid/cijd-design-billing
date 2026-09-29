#!/usr/bin/env bash
# Read-only smoke check: the deployed V5, and that V3 and V4 still load.
# Only GET requests; nothing is written anywhere.
#
#   scripts/v5-smoke.sh [V5_URL]
set -uo pipefail

SUB="${CIJD_WORKERS_SUBDOMAIN:-hrk-freelance}"
V5="${1:-${V5_BASE_URL:-https://cijd-design-billing-v5-preview.$SUB.workers.dev}}"
V3="${V3_URL:-https://cijd-design-billing-preview.$SUB.workers.dev}"
V4="${V4_URL:-https://cijd-design-billing-v4-preview.$SUB.workers.dev}"
fail=0

check() { # name expected-status url [must-contain]
  local name=$1 want=$2 url=$3 needle=${4:-}
  local body status
  body=$(curl -sS -m 30 -o /tmp/v5-smoke.$$ -w '%{http_code}' "$url") || body=000
  status=$body
  if [ "$status" != "$want" ]; then
    echo "FAIL $name: HTTP $status (want $want) $url"; fail=1; return
  fi
  if [ -n "$needle" ] && ! grep -q -- "$needle" /tmp/v5-smoke.$$; then
    echo "FAIL $name: '$needle' not found $url"; fail=1; return
  fi
  echo "PASS $name: HTTP $status $url"
}

echo "== V5 $V5"
check "V5 Billing"      200 "$V5/office-v5" 'v5-accounting'
check "V5 Accounting"   200 "$V5/office-v5/accounting"
check "V5 Archive"      200 "$V5/office-v5/archive"
check "V5 data"         200 "$V5/api/state" '"taxInvoices"'
check "V5 session"      200 "$V5/api/session" '"access":"active"'
check "V5 has no V3"    302 "$V5/office-v3"
check "V5 import off"   "${V5_IMPORT_EXPECT:-404}" "$V5/api/v5/import"

echo "== V3 $V3 (must be unchanged)"
check "V3 Billing"      200 "$V3/office-v3" 'data-cijd-v3-build'

echo "== V4 $V4 (must be unchanged)"
check "V4 home"         200 "$V4/"

rm -f /tmp/v5-smoke.$$
[ $fail = 0 ] && echo "SMOKE: PASS" || echo "SMOKE: FAIL"
exit $fail
