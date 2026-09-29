#!/usr/bin/env bash
# Build V5 and run it locally on a throwaway D1 (wrangler dev), for E2E.
# Never touches V3's Supabase, V4's D1, or any remote resource.
#
#   scripts/v5-local.sh            # build + fresh local D1 + wrangler dev on :8787
#   V5_KEEP_DATA=1 scripts/v5-local.sh   # keep the local D1 between runs
set -euo pipefail
cd "$(dirname "$0")/.."

PERSIST="${V5_PERSIST_DIR:-.wrangler/v5-local}"
export WRANGLER_LOG_PATH="${WRANGLER_LOG_PATH:-.wrangler/logs}"

# No Supabase variables in a V5 build, ever.
unset NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY

CIJD_WRANGLER_CONFIG=wrangler.v5.jsonc npx vinext build
[ "${V5_KEEP_DATA:-}" = "1" ] || rm -rf "$PERSIST"
npx wrangler d1 migrations apply cijd-design-billing-v5-preview --local \
  --config dist/server/wrangler.json --persist-to "$PERSIST"
exec npx wrangler dev --config dist/server/wrangler.json --persist-to "$PERSIST" \
  --port "${V5_PORT:-8787}" --ip 127.0.0.1 \
  --var CIJD_TEST_MODE:1 --var CIJD_TEST_NBC_RATE:4105 --var CIJD_TEST_NBC_RATE_DATE:2026-09-29 \
  ${V5_IMPORT_TOKEN:+--var V5_IMPORT_TOKEN:$V5_IMPORT_TOKEN}
