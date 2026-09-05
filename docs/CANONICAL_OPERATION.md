# CIJD DESIGN Billing — Canonical Operation

このファイルが「どこが正本か」「どう公開するか」の恒久ルールです。

## Source of Truth

| Item | Value |
| --- | --- |
| Repository | `hrkfreelance-droid/cijd-design-billing` |
| Canonical review branch | `integrate-production-workspace` |
| Supabase Project Ref | `dldfhhcechzhkbvlnzld` |
| Normal Cloudflare target | Fixed Review Worker only |
| Review Worker | `cijd-design-billing-preview` |
| Review URL | `https://cijd-design-billing-preview.hrk-freelance.workers.dev` |
| Automated deployment owner | Cloudflare Workers native Git integration |
| Production | 明示許可があるまで触らない |
| Netlify | 明示許可があるまで触らない |
| `main` | 書き込み禁止 |

毎回、作業開始時に `git fetch --all --prune` を行い、その時点の `origin/integrate-production-workspace` HEAD をReview環境の正本とします。会話や古い資料に残るSHAを最新版として使いません。

## Permanent Review environment

固定Review URLは次の1本です。

`https://cijd-design-billing-preview.hrk-freelance.workers.dev`

このReview Workerを、ChatGPT / Codex / Claude Code / human maintainer が継続して更新できる恒久開発環境として扱います。

通常の追加修正で新しいホスティング先を毎回作りません。大きめの変更は `review/*` branch で安全に作業し、確認・承認後に `integrate-production-workspace` へ取り込みます。Cloudflare WorkersのGit連携が同じ固定Review Workerを自動更新します。

## Deployment flow

```text
git fetch --all --prune
        ↓
current origin/integrate-production-workspace を確認
        ↓
必要なら review/* branch で実装
        ↓
typecheck / relevant lint / build / tests
        ↓
反映前 integrate-production-workspace SHA を rollback point として記録
        ↓
approved change を integrate-production-workspace へ反映
        ↓
Cloudflare Workers native Git integration が自動build/deploy
        ↓
Review Worker cijd-design-billing-preview 更新
        ↓
/api/version を確認
        ↓
live commit == current integrate-production-workspace HEAD
        ↓
LIVE PASS
```

## Cloudflare configuration

Worker `cijd-design-billing-preview` はGitHub repository `hrkfreelance-droid/cijd-design-billing` とWorkers Buildsで接続します。

- Production branch: `integrate-production-workspace`
- Build command: `npm run build:vinext`
- Production deploy command: Cloudflare default / `npx wrangler deploy`
- Non-production branch builds: ON when branch previews are wanted
- Non-production deploy: Cloudflare default / `npx wrangler versions upload`
- `workers_dev: true`
- `preview_urls: true`

Cloudflare Git integration自身が認証を保持するため、通常運用のためにGitHub Actionsへ `CLOUDFLARE_API_TOKEN` を追加しません。Cloudflare公式Workers BuildsのGit連携を正本とします。

## Version gate

`GET /api/version` は必ず `Cache-Control: no-store` で build identity を返します。

固定Review URLを「最新」と案内する前に、少なくとも次を確認します。

```json
{
  "commit": "<full sha>",
  "shortCommit": "<8 chars>",
  "branch": "integrate-production-workspace",
  "builtAt": "<ISO timestamp>",
  "environment": "review"
}
```

Build成功だけで公開完了とは言いません。

## PASS definitions

- **CODE PASS**: 対象コードがcommit/push済みで、必要なtypecheck/tests/buildが成功。
- **DEPLOY PASS**: Cloudflare Workers build/deploy が成功。
- **LIVE PASS**: 固定Review URL の `/api/version` が最新 `integrate-production-workspace` HEAD と一致。

3つは別物です。

## Rollback

Review更新前の `integrate-production-workspace` HEAD を必ず記録します。

問題があればGitでその変更をrevert、または記録した前コミットへReview branchを復元し、Cloudflare Git integrationに再deployさせます。Cloudflare Version historyも補助に使えますが、Gitを正本にします。

**UIロールバックでSupabaseデータをreset・truncate・reseedしません。**

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

## Mandatory start-of-task preflight

今後のWeb更新は、実装を始める前に必ず確認します。

1. repository
2. current review/source branch
3. Cloudflare Worker name
4. fixed Review URL
5. build command
6. deploy owner = Cloudflare native Git integration
7. rollback SHA
8. production/main authorization state

デプロイ設定を実装の最後に初めて確認する進め方は禁止します。
