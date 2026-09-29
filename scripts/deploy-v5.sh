#!/usr/bin/env bash
# Deploy CIJD Billing V5 as its own Worker with its own D1 database.
#
#   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… scripts/deploy-v5.sh
#   (or run after `npx wrangler login`)
#
# Safety:
#   - refuses any Worker name other than cijd-design-billing-v5-preview
#     (never the V3 Worker cijd-design-billing-preview or V4's -v4-preview)
#   - creates/uses only the D1 database cijd-design-billing-v5-preview
#   - applies only migrations-v5/ (additive, V5-only tables)
#   - builds with no Supabase variables, so V5 cannot reach V3's data
set -euo pipefail
cd "$(dirname "$0")/.."

WORKER="cijd-design-billing-v5-preview"
DB="cijd-design-billing-v5-preview"
export WRANGLER_LOG_PATH="${WRANGLER_LOG_PATH:-.wrangler/logs}"
unset NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY

name=$(node -e 'const t=require("fs").readFileSync("wrangler.v5.jsonc","utf8").replace(/^\s*\/\/.*$/gm,"");console.log(JSON.parse(t).name)')
if [ "$name" != "$WORKER" ]; then
  echo "Refusing to deploy: wrangler.v5.jsonc names '$name', expected '$WORKER'." >&2
  exit 1
fi

echo "== D1: $DB"
id=$(npx wrangler d1 list --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const db=JSON.parse(s).find(d=>d.name===process.argv[1]);console.log(db?db.uuid:"")})' "$DB")
if [ -z "$id" ]; then
  npx wrangler d1 create "$DB"
  id=$(npx wrangler d1 list --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.parse(s).find(d=>d.name===process.argv[1]).uuid)})' "$DB")
fi
echo "   id $id"

# A deploy copy of the V5 config with the real database id (git-ignored).
sed "s/00000000-0000-0000-0000-000000000000/$id/" wrangler.v5.jsonc > wrangler.v5.deploy.jsonc

echo "== build"
CIJD_WRANGLER_CONFIG=wrangler.v5.deploy.jsonc npx vinext build
built=$(node -e 'console.log(require("./dist/server/wrangler.json").name)')
[ "$built" = "$WORKER" ] || { echo "Built config names '$built'; refusing." >&2; exit 1; }

echo "== migrations (V5 D1 only)"
npx wrangler d1 migrations apply "$DB" --remote --config dist/server/wrangler.json

echo "== deploy $WORKER"
npx vinext-cloudflare deploy --config dist/server/wrangler.json

subdomain=${CIJD_WORKERS_SUBDOMAIN:-hrk-freelance}
url="https://$WORKER.$subdomain.workers.dev"
echo "== smoke test (V5 up, V3 and V4 unchanged)"
scripts/v5-smoke.sh "$url"
echo "V5: $url/office-v5"
