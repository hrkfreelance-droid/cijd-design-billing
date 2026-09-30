#!/usr/bin/env bash
# CIJD Billing V5 — Invoice Management deploy and live verification, one
# command, on a machine that can reach Cloudflare (the Mac mini).
#
#   npx wrangler login                 # or CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
#   npx playwright install chromium    # once, for the browser E2E
#   scripts/v5-ims-deploy.sh
#
# Gates (stops at the first failure and prints the rollback):
#   1 local: branch, clean tree, HEAD = pushed branch, discount policy = BEFORE_VAT
#   2 rollback point: backup branch + tag v5-pre-invoice-management-20260930 → 0e4bfb2
#   3 read-only baseline: V5/V3/V4 Worker versions, V5 D1 id + migrations, V5 data
#   4 deploy V5 only (scripts/deploy-v5.sh: migration 0002, Worker, smoke)
#   5 migrations + data reconciliation (every existing record/number/total unchanged)
#   6 browser E2E on the live V5 (TEST client, TEST- number series, cleaned up)
#   7 reconciliation again (no real CIJDTI number consumed), V3/V4 GET + versions unchanged
#
# V3 and V4 are only read (HTTP GET, `wrangler deployments list`). Nothing
# here deploys, migrates or writes them. Reports: .data/v5-ims-deploy/<time>/.
set -euo pipefail
cd "$(dirname "$0")/.."

BRANCH="feature/billing-v5-accounting-integration"
BACKUP_BRANCH="backup/v5-pre-invoice-management-20260930"
TAG="v5-pre-invoice-management-20260930"
ROLLBACK_COMMIT="0e4bfb291a43e732005ce1b33fb43e34c6310070"
WORKER="cijd-design-billing-v5-preview"
DB="cijd-design-billing-v5-preview"
V3_WORKER="cijd-design-billing-preview"
V4_WORKER="cijd-design-billing-v4-preview"
SUB="${CIJD_WORKERS_SUBDOMAIN:-hrk-freelance}"
V5_URL="https://$WORKER.$SUB.workers.dev"
V3_URL="https://$V3_WORKER.$SUB.workers.dev"
V4_URL="https://$V4_WORKER.$SUB.workers.dev"
RUN=".data/v5-ims-deploy/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$RUN"
exec > >(tee -a "$RUN/deploy.log") 2>&1
export WRANGLER_LOG_PATH="${WRANGLER_LOG_PATH:-.wrangler/logs}"

step() { printf '\n==== %s\n' "$*"; }
PRE_VERSION=""
DEPLOYING=0
die() { echo "STOP: $*" >&2; [ "$DEPLOYING" = 1 ] && rollback_hint; exit 1; }
rollback_hint() {
  echo
  echo "ROLLBACK (V5 only):"
  [ -n "$PRE_VERSION" ] && [ "$PRE_VERSION" != none ] && echo "  npx wrangler rollback $PRE_VERSION --name $WORKER"
  echo "  or: git checkout $TAG && npm run deploy:v5"
  echo "  Migration 0002 only added v5_invoice_revisions; the old code runs on it unchanged."
  echo "Reports: $RUN"
}

step "1/7 local state"
[ "$(git branch --show-current)" = "$BRANCH" ] || die "not on $BRANCH"
[ -z "$(git status --porcelain)" ] || { git status --short; die "working tree has changes; commit or stash them first"; }
git fetch -q origin "$BRANCH"
[ "$(git rev-parse HEAD)" = "$(git rev-parse "origin/$BRANCH")" ] || die "HEAD $(git rev-parse --short HEAD) is not the pushed origin/$BRANCH"
grep -q 'DISCOUNT_VAT_POLICY: DiscountVatPolicy = "DISCOUNT_BEFORE_VAT";' src/lib/billing-v5/calculation.ts || die "DISCOUNT_VAT_POLICY is not the confirmed DISCOUNT_BEFORE_VAT"
DEPLOY_COMMIT=$(git rev-parse --short HEAD)
echo "commit $DEPLOY_COMMIT on $BRANCH"

step "2/7 rollback point"
remote_backup=$(git ls-remote origin "refs/heads/$BACKUP_BRANCH" | cut -f1)
[ "$remote_backup" = "$ROLLBACK_COMMIT" ] || die "origin/$BACKUP_BRANCH is '$remote_backup', expected $ROLLBACK_COMMIT"
if ! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  git tag -a "$TAG" "$ROLLBACK_COMMIT" -m "V5 before Invoice Management expansion (rollback point)"
fi
[ "$(git rev-parse "$TAG^{commit}")" = "$ROLLBACK_COMMIT" ] || die "local tag $TAG does not point at $ROLLBACK_COMMIT"
remote_tag=$(git ls-remote origin "refs/tags/$TAG^{}" | cut -f1)
[ -z "$remote_tag" ] && remote_tag=$(git ls-remote origin "refs/tags/$TAG" | cut -f1)
if [ -z "$remote_tag" ]; then
  git push origin "refs/tags/$TAG"   # never --force
  remote_tag=$(git ls-remote origin "refs/tags/$TAG^{}" | cut -f1)
fi
[ "$remote_tag" = "$ROLLBACK_COMMIT" ] || die "origin tag $TAG is '$remote_tag', expected $ROLLBACK_COMMIT (not overwritten)"
echo "backup branch and tag → $ROLLBACK_COMMIT"

step "3/7 read-only baseline"
npx wrangler whoami | tee "$RUN/whoami.txt"
for w in "$WORKER" "$V3_WORKER" "$V4_WORKER"; do
  npx wrangler deployments list --name "$w" --json > "$RUN/pre-deployments-$w.json" || die "cannot read deployments of $w"
done
latest_version() { node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const x=(Array.isArray(d)?d:[]).slice().sort((a,b)=>String(b.created_on).localeCompare(String(a.created_on)))[0];console.log(x?(x.versions||[]).map(v=>v.version_id).join("+"):"none")' "$1"; }
PRE_VERSION=$(latest_version "$RUN/pre-deployments-$WORKER.json" | cut -d+ -f1)
echo "V5 Worker $WORKER version before: $PRE_VERSION"
echo "V3 version: $(latest_version "$RUN/pre-deployments-$V3_WORKER.json")   V4 version: $(latest_version "$RUN/pre-deployments-$V4_WORKER.json")"

DB_ID=$(npx wrangler d1 list --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const db=JSON.parse(s).find(d=>d.name===process.argv[1]);console.log(db?db.uuid:"")})' "$DB")
[ -n "$DB_ID" ] || die "D1 '$DB' does not exist: V5 was never deployed. Run scripts/v5-go-live.sh (first deploy + V3 import) instead."
echo "V5 D1 $DB id $DB_ID"
sed "s/00000000-0000-0000-0000-000000000000/$DB_ID/" wrangler.v5.jsonc > wrangler.v5.deploy.jsonc
npx wrangler d1 migrations list "$DB" --remote --config wrangler.v5.deploy.jsonc | tee "$RUN/pre-migrations.txt"
npm run -s v5:reconcile -- --save "$V5_URL" "$RUN/before.json"
for u in "$V3_URL/office-v3" "$V4_URL/"; do echo "GET $u → $(curl -s -m 30 -o /dev/null -w '%{http_code}' "$u")"; done

step "4/7 deploy V5 only"
DEPLOYING=1
trap rollback_hint ERR
scripts/deploy-v5.sh

step "5/7 migrations and data reconciliation"
npx wrangler d1 migrations list "$DB" --remote --config wrangler.v5.deploy.jsonc | tee "$RUN/post-migrations.txt"
grep -q "No migrations to apply" "$RUN/post-migrations.txt" || die "migrations still pending after deploy"
npx wrangler deployments list --name "$WORKER" --json > "$RUN/post-deployments-$WORKER.json"
echo "V5 Worker version after: $(latest_version "$RUN/post-deployments-$WORKER.json")"
sleep 5
npm run -s v5:reconcile -- --save "$V5_URL" "$RUN/after-deploy.json"
npm run -s v5:reconcile -- "$RUN/before.json" "$RUN/after-deploy.json" --out "$RUN/reconcile-after-deploy.md"

step "6/7 browser E2E on the live V5 (TEST data only)"
imported=$(node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log((d.projects||[]).some(p=>!String(p.name).startsWith("TEST"))?1:0)' "$RUN/before.json")
V5_BASE_URL="$V5_URL" V5_EXPECT_IMPORTED="$imported" V5_SHOTS_DIR="$RUN/screenshots" \
  npx playwright test -c playwright.v5.config.ts

step "7/7 reconciliation after E2E; V3/V4 unchanged"
npm run -s v5:reconcile -- --save "$V5_URL" "$RUN/after-e2e.json"
npm run -s v5:reconcile -- "$RUN/before.json" "$RUN/after-e2e.json" --out "$RUN/reconcile-after-e2e.md"
for w in "$V3_WORKER" "$V4_WORKER"; do
  npx wrangler deployments list --name "$w" --json > "$RUN/post-deployments-$w.json"
  [ "$(latest_version "$RUN/pre-deployments-$w.json")" = "$(latest_version "$RUN/post-deployments-$w.json")" ] || die "$w version changed during the run"
  echo "$w version unchanged: $(latest_version "$RUN/post-deployments-$w.json")"
done
scripts/v5-smoke.sh "$V5_URL"
trap - ERR

echo
echo "DEPLOYED COMMIT: $DEPLOY_COMMIT"
echo "ROLLBACK: $BACKUP_BRANCH / tag $TAG → $ROLLBACK_COMMIT; pre-deploy Worker version $PRE_VERSION"
echo "V5 LIVE: $V5_URL/office-v5"
echo "Reports: $RUN (deploy.log, before.json, reconcile-*.md, screenshots/)"
