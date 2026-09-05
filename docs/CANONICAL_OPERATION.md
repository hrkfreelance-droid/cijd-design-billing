# CIJD DESIGN Billing — Canonical Operation

このファイルが「どこが正本か」「どう公開するか」の恒久ルールです。

## Source of Truth

| Item | Value |
| --- | --- |
| Repository | `hrkfreelance-droid/cijd-design-billing` |
| Canonical branch | `integrate-production-workspace` |
| Supabase Project Ref | `dldfhhcechzhkbvlnzld` |
| Normal Cloudflare target | Review Worker only |
| Review Worker | `cijd-design-billing-preview` |
| Production | 明示許可があるまで触らない |
| Netlify | 明示許可があるまで触らない |
| `main` | 書き込み禁止 |

毎回、作業開始時に `git fetch --all --prune` を行い、その時点の
`origin/integrate-production-workspace` HEAD を正本とします。会話や古い資料に残るSHAを最新版として使いません。

また、実装開始前に `docs/CLOUDFLARE_PREVIEW_OPERATION.md` を確認し、Cloudflare Preview と rollback の経路を先に確定します。

## Cloudflare deployment model

CIJDの通常開発では **Cloudflare Workers native Git integration** を正本とします。
GitHub ActionsからCloudflareへ独自デプロイする経路は通常使いません。

### Work-in-progress branch

`review/*` 等の非本番ブランチは Cloudflare の non-production branch build で処理します。

```text
latest origin/integrate-production-workspace
        ↓
review/<topic> branch
        ↓
typecheck / relevant lint / build
        ↓
push
        ↓
Cloudflare Workers Builds
        ↓
branch/version Preview URL
        ↓
/api/version と branch HEAD を照合
        ↓
BRANCH LIVE PASS
```

この branch Preview は固定 Review Worker の現在版を上書きしません。
Cloudflareが出す branch/version `workers.dev` URL は、レビュー中の変更確認用途として正式に利用してよいものとします。

### Canonical Review branch

固定URLは次です。

`https://cijd-design-billing-preview.hrk-freelance.workers.dev`

このURLは `integrate-production-workspace` の正本状態を表します。
レビュー承認後に変更を `integrate-production-workspace` へ取り込んだときのみ、Cloudflare Git integration または明示的な安全な手動fallbackで固定Review Workerを更新します。

## Cloudflare one-time configuration

Cloudflare側の恒久設定は `docs/CLOUDFLARE_PREVIEW_OPERATION.md` を正本とします。
最低条件:

- GitHub repository: `hrkfreelance-droid/cijd-design-billing`
- Production branch: `integrate-production-workspace`
- Build command: `npm run build:vinext`
- Builds for non-production branches: ON
- Non-production deploy: `wrangler versions upload` 相当
- Preview URLs: ON

root `wrangler.jsonc` でも `workers_dev: true` と `preview_urls: true` を明示します。

## Manual deployment fallback

`npm run deploy:review` はローカル/手動fallback用の強制ガードです。

- 現在ブランチが `integrate-production-workspace` 以外なら停止
- local HEAD と remote HEAD が違えば停止
- build SHA / branch / builtAt / environment を build/runtime に注入
- generated Wrangler config の Worker 名を `cijd-design-billing-preview` に固定
- `wrangler deploy` を使用
- Production Worker 名では deploy できない

通常のreview branch確認のためにGitHub Actionsへ `CLOUDFLARE_API_TOKEN` を追加する方式は採用しません。

## Version gate

`GET /api/version` は必ず `Cache-Control: no-store` で次を返します。

```json
{
  "commit": "<full sha>",
  "shortCommit": "<8 chars>",
  "branch": "<git branch>",
  "builtAt": "<ISO timestamp>",
  "environment": "review"
}
```

HTMLにも `cijd-build-sha` metaを出します。

固定Review URLでは `npm run verify:live` が `origin/integrate-production-workspace` HEAD と比較します。
Branch Previewでは `/api/version.commit` と対象branch HEADを比較します。
不一致・取得失敗・branch/environment違いは失敗として扱い、`DO NOT CLAIM LIVE COMPLETE` とします。

## PASS definitions

- **CODE PASS**: 対象コードがcommit/push済みで、必要なtypecheck/tests/buildが成功。
- **DEPLOY PASS**: Cloudflare上で対象branch/versionのdeployが成功。
- **BRANCH LIVE PASS**: branch Preview URLの `/api/version` が対象branch HEADと一致。
- **LIVE PASS**: 固定Review URLの `/api/version` が最新 `origin/integrate-production-workspace` HEADと一致。

これらは別物です。Build成功だけで「公開完了」と言いません。

## Rollback

- Branch Preview: Git commit と Cloudflare Worker version history を利用し、固定Review Workerは触らない。
- Canonical Review: 直前に検証済みの `integrate-production-workspace` commit を再デプロイできる状態を維持する。
- UI rollbackのためにSupabaseの実データをreset/変更しない。

## Supabase migration rule

- 適用済みmigrationは編集しない。
- 修正は新しいcorrective migrationを追加する。
- GitにmigrationがあることとLive DBに適用済みであることは別々に確認する。
- CIJD以外のSupabase projectを触らない。

## UI / product rule

CIJDの通常操作は「リストを見失わない」ことを優先します。

- 編集は原則 modal / sheet。単純編集のために別ページへ遷移しない。
- 行・カードは文字だけでなく面全体を押せるようにする。
- 運用キューは oldest first (FIFO)。
- Headerに主要操作を詰め込みすぎない。
- Print cost と customer billing を混同しない。
- Invoiced / Paid / imported history は勝手に書き換えない。
