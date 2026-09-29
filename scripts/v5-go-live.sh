#!/usr/bin/env bash
# CIJD Billing V5 go-live, one command, on a machine that can reach Cloudflare
# and Supabase. Stops at the first failed gate.
#
#   npx wrangler login                      # or CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
#   export SUPABASE_URL=https://dldfhhcechzhkbvlnzld.supabase.co
#   export SUPABASE_SERVICE_ROLE_KEY=…      # used for GET requests only (V3 is never written)
#   npx playwright install chromium         # once, for the browser E2E
#   scripts/v5-go-live.sh
#
# Gates:
#   1 deploy V5 (own Worker, own D1)        4 import into the empty V5, verify
#   2 smoke: V5 up, V3 and V4 still load    5 browser E2E on the deployed URL (TEST data, cleaned up)
#   3 read V3, dry-run report, confirm      6 verify again, remove the import token, smoke again
#
# V3 and V4 are only read (GET). Their Workers and databases are never deployed to or written.
set -euo pipefail
cd "$(dirname "$0")/.."

WORKER="cijd-design-billing-v5-preview"
SUB="${CIJD_WORKERS_SUBDOMAIN:-hrk-freelance}"
V5_URL="${V5_URL:-https://$WORKER.$SUB.workers.dev}"
RUN_DIR=".data/v5-go-live/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$RUN_DIR"
exec > >(tee -a "$RUN_DIR/go-live.log") 2>&1

: "${SUPABASE_URL:?set SUPABASE_URL}"
: "${SUPABASE_SERVICE_ROLE_KEY:?set SUPABASE_SERVICE_ROLE_KEY (read-only use)}"

step() { printf '\n==== %s\n' "$*"; }

step "1/6 deploy V5"
scripts/deploy-v5.sh

step "2/6 smoke (V5 up, V3 and V4 unchanged)"
scripts/v5-smoke.sh "$V5_URL"

step "3/6 read V3 and dry-run the import (V5 not touched)"
npm run -s v5:import -- --out "$RUN_DIR/dry-run"
if [ "${V5_GO_LIVE_YES:-}" != "1" ]; then
  read -r -p "Import these records into $V5_URL? [y/N] " answer
  [ "$answer" = "y" ] || { echo "Stopped before import."; exit 1; }
fi

step "4/6 import into V5 and verify"
V5_IMPORT_TOKEN=$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')
export V5_IMPORT_TOKEN
remove_token() { echo y | npx wrangler secret delete V5_IMPORT_TOKEN --name "$WORKER" >/dev/null 2>&1 || true; }
trap remove_token EXIT
printf '%s' "$V5_IMPORT_TOKEN" | npx wrangler secret put V5_IMPORT_TOKEN --name "$WORKER"
for i in $(seq 1 20); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' -H "authorization: Bearer $V5_IMPORT_TOKEN" "$V5_URL/api/v5/import")" = 200 ] && break
  sleep 3
done
npm run -s v5:import -- --target "$V5_URL" --commit --out "$RUN_DIR/import"

step "5/6 browser E2E on the deployed V5"
V5_BASE_URL="$V5_URL" V5_EXPECT_IMPORTED=1 V5_SHOTS_DIR="$RUN_DIR/screenshots" \
  npx playwright test -c playwright.v5.config.ts

step "6/6 verify imported records are unchanged, remove the token, smoke"
npm run -s v5:import -- --target "$V5_URL" --verify --out "$RUN_DIR/verify"
remove_token
trap - EXIT
sleep 5
scripts/v5-smoke.sh "$V5_URL"

echo
echo "V5 LIVE: $V5_URL/office-v5"
echo "Reports: $RUN_DIR (dry-run/, import/, verify/, screenshots/, go-live.log)"
