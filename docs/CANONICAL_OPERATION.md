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

## Canonical Review URL

固定URL候補は次の1本です。

`https://cijd-design-billing-preview.hrk-freelance.workers.dev`

**現在は Live 未検証です。** Cloudflare 側で Review Worker の workers.dev 固定URLが有効になり、`/api/version` が remote HEAD と一致するまで「Canonical Live」とは扱いません。

Cloudflareが出す `<hash>-...workers.dev` のVersion URLは調査・履歴用であり、通常共有の入口にしません。

## Deployment flow

```text
git fetch --all --prune
        ↓
origin/integrate-production-workspace と local HEAD が一致
        ↓
typecheck / tests / build
        ↓
npm run deploy:review
        ↓
Review Worker cijd-design-billing-preview のみ更新
        ↓
npm run verify:live
        ↓
/api/version.commit == origin/integrate-production-workspace HEAD
        ↓
LIVE PASS
```

`npm run deploy:review` はローカル/手動デプロイ用の強制ガードです。

- 現在ブランチが `integrate-production-workspace` 以外なら停止
- local HEAD と remote HEAD が違えば停止
- build SHA / branch / builtAt / environment を build/runtime に注入
- generated Wrangler config の Worker 名を `cijd-design-billing-preview` に固定
- `wrangler deploy` を使用
- Production Worker 名では deploy できない

Cloudflare Git integration は CI の detached HEAD でも動作する必要があるため、`deploy:vinext` は vinext 標準の deploy command を維持します。ただし root `wrangler.jsonc` の Worker 名は `cijd-design-billing-preview` に固定し、Git integration の対象も Review Worker のみとします。

## Version gate

`GET /api/version` は必ず `Cache-Control: no-store` で次を返します。

```json
{
  "commit": "<full sha>",
  "shortCommit": "<8 chars>",
  "branch": "integrate-production-workspace",
  "builtAt": "<ISO timestamp>",
  "environment": "review"
}
```

HTMLにも `cijd-build-sha` metaを出します。

`npm run verify:live` は remote HEAD と Canonical Review URL の `/api/version` を比較します。不一致・取得失敗・branch/environment違いは失敗し、`DO NOT CLAIM LIVE COMPLETE` を表示します。

## PASS definitions

- **CODE PASS**: 対象コードがcommit/push済みで、必要なtypecheck/tests/buildが成功。
- **DEPLOY PASS**: Review Workerへのdeployコマンドが成功。
- **LIVE PASS**: 固定URLの `/api/version` が最新remote HEADと一致し、必要なLive確認も成功。

3つは別物です。Build成功だけで「公開完了」と言わないこと。

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
