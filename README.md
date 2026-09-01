# CIJD DESIGN Billing

CIJD DESIGN の案件・請求・経理管理 Web アプリ。
制作 → 印刷 → 請求 → 経理を、納品を境界に一本道で管理します。請求書PDFは請求発行時に生成され、後から再表示・保存できます。

## Preview

公開PreviewはCloudflare Workersの固定URLで実行します。Supabaseのbuild variablesが設定されている場合は本番と同じSupabase ledgerを使い、未設定のPreviewは安全にログイン待ちで停止します。browser-local Demo Storeは明示的なローカル検証時だけ使います。
[Open Cloudflare Preview](https://cijd-design-billing-preview.hrk-freelance.workers.dev/)
ローカルでの起動方法は [Local Development](#local-development) を参照してください。

`CIJD_PREVIEW_MODE=1` だけではDemoへ切り替わりません。Supabase credentialsがあるPreviewはCloudflare → Supabase Auth → Supabase Databaseで動作し、credentialsが無い場合もlocal ledgerへフォールバックしません。

## Overview

```
Designer / Printing                   Office
────────────────────                  ────────────────
作る・価格を決める → 納品 ──DELIVERED──▶ 請求済みにする → 経理 → 入金確認 → 完了
```

請求担当は進行状況を確認できます。Billingには、請求可能な項目と、印刷価格の確定を待つ項目を分けて表示します。

## Features

**Designer（`/designer/projects`。`/designer` からもリダイレクト）**
- 制作・印刷・請求・経理をワークスペース切替で確認・操作
- 案件と請求項目の登録、完了・納品、価格決定、請求済み、入金確認
- 各工程のUndoを確認付きで実行

**Office（`/office`）**
- 進行状況（READ ONLY）/ 請求（請求待ち）/ 経理（請求済み・入金確認・完了）/ アーカイブ
- 進行状況はClient → Project → Itemを状態だけで確認し、制作・印刷の操作はできない
- 納品済み・価格確定済みの項目だけが請求候補に出る。価格確認待ちの印刷項目は選択できない状態で表示する
- Invoice ID/Number は内部で自動生成

**守っているルール**
- `productionStatus` が `DELIVERED` または `COMPLETED` でない項目は、請求待ちにも Invoice にもできない（UI・API・データ層すべてで拒否）
- 請求済み・入金済みの項目は編集・削除・再請求ができない
- 同じ請求書番号は登録できない。入金済みへの再入金確認はエラー
- 請求・入金の取り消しは確認付きで、履歴は消さずに残す

## Access Control

| Role | 見られるもの |
| --- | --- |
| `DESIGNER` | 制作・印刷・請求・経理の確認と操作 |
| `PRINTING` | 印刷仕様・価格確認、印刷物の納品操作 |
| `BILLING` | 進行状況のREAD ONLY確認、請求待ち、請求書発行、請求取消、経理の閲覧 |
| `ACCOUNTING` | 進行状況のREAD ONLY確認、経理、入金確認、入金取消、完了、Archive |
| `ADMIN` | 全画面（ワークスペース切替つき） |

Navigation を隠すだけではありません。`/designer` と `/office` はサーバー側でも判定してリダイレクトし、
API は `GuardedRepository` を通すため、**権限外のデータはそもそも返りません**
（例：BILLING の `/api/state` には進行状況確認のための項目が含まれますが、制作・印刷の書き込みAPIは403になります）。

認証は Supabase Auth + Google OAuthです（未設定時の担当選択はローカル開発専用）。
Role は常にサーバー側で `users` テーブルから読み直すため、Cookie やトークンの改ざんで権限は増えません。

## Tech Stack

Next.js 16（App Router）/ TypeScript / Tailwind CSS v4 / Supabase / Playwright

データ層は `Repository` インターフェースで分離しています。
`NEXT_PUBLIC_SUPABASE_URL` などを設定すると **Supabase（DB + Auth）** に、未設定ならローカル JSON ストアに自動で切り替わります。
セットアップ手順は [`supabase/README.md`](supabase/README.md)。

**DB が自力で守るもの**（アプリを迂回しても破れません）
- `billing_needs_delivery` — 未納品の項目は請求待ち・請求済み・入金済みになれない
- `invoice_items.billing_item_id` UNIQUE — 1項目が2つの請求書に載らない
- `invoices_number_unique` — 有効な請求書番号は重複しない
- `payments_one_live_per_invoice` — 1請求書につき有効な入金は1件
- RLS — 請求・経理は未納品データを読めず、制作側は請求・入金を読めない

## Local Development

```bash
npm install
npm run dev          # http://localhost:3000
```

初回起動時に `.data/runtime/db.json` が作成されます。既存の `.data/db.json` は
手動検証・Import証拠として保全され、自動Runtimeでは使用しません。ローカルのNext生成物は
`.next-local` に出力し、既存の `.next` も保全します。
サインイン画面で担当（Hiroki / Printing Staff / Billing Staff / Accounting）を選ぶと、Role ごとのワークスペースに入ります。Hiroki は Designer として制作から経理まで切り替えて操作できます。

## Cloudflare Preview

公開Previewの実行基盤はCloudflare Workersを第一候補とし、Next.js 16向けの公式推奨に沿って
vinextを使用します。`integrate-production-workspace` へのpushをPreview Workerの自動build/deployに
接続できます。ユーザーはCloudflareが発行した固定Worker URLを開くだけで、Terminal・
git pull・Port操作は不要です。

Preview buildは `CIJD_PREVIEW_MODE=1` を保持します。Supabase build variablesがある場合はserver API・route guard・GuardedRepositoryが有効になり、ない場合はGoogleログインの設定待ちで停止します。localStorageの操作状態をSupabaseへコピーすることはありません。
Production/PreviewでSupabase未設定のWorkerは引き続きfail closedし、PreviewのlocalStorageや `.data/runtime/db.json`
を本番業務DBとして使いません。

Cloudflare Workers Buildsの一度きりの接続設定は次の値です。

- Repository: `hrkfreelance-droid/cijd-design-billing`
- Preview branch: `integrate-production-workspace`
- Build command: `npm run build:vinext`
- Deploy command: `npm run deploy:vinext`
- Worker: `cijd-design-billing-preview`

For real operation, set these as Cloudflare Workers Builds environment variables
before the build (never commit them): `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY`. Keep `SUPABASE_SERVICE_ROLE_KEY` server-only;
it is not a `NEXT_PUBLIC_*` value.

Production branchはこのPreview設定に含めません。Cloudflare account側のGitHub接続と
workers.dev設定が完了した後は、対象branchへのpushだけでPreviewが更新されます。

| コマンド | 内容 |
| --- | --- |
| `npm run build` / `npm start` | 本番ビルド・起動 |
| `npm run lint` / `npm run typecheck` | 静的チェック |
| `npm test` | Playwright（役割分離・納品ゲート・請求〜入金・PDF導線） |
| `npm run test:import` | 過去履歴Importの判定・リンクテスト |
| `npm run import:history` | 過去請求履歴の CSV 取り込み（後述） |
| `npm run test:auth` | Auth provisioning引数の安全性テスト |
| `npm run supabase:user -- ...` | 実メールアドレスでAuth Userを作成（trusted terminalのみ） |
| `npm run shots` | 主要画面のスクリーンショット出力 |

`npm test` は専用ポートと使い捨てデータでサーバーを起動するため、実行前に `npm run dev` を停止してください。

## Environment Variables

`.env.example` をコピーして `.env.local` を作成してください。`.env*` は `.gitignore` 済みで、**Secret はコミットしません**。

| 変数 | 用途 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 設定すると Supabase（DB + Auth）に切り替わります |
| `SUPABASE_SERVICE_ROLE_KEY` | Auth User provisioning CLI専用。ブラウザやWorkerには設定しません |
| `CIJD_DATA_FILE` | ローカル JSON ストアの保存先（既定：`.data/runtime/db.json`） |
| `CIJD_NEXT_DIST_DIR` | Next生成物の保存先（npm scriptsの既定：`.next-local`） |
| `NEXT_PUBLIC_DEMO_MODE` | 開発時のみブラウザ内デモデータへ切り替え（Production Previewでは使用しない） |
| `CIJD_PREVIEW_MODE` | Cloudflare Preview識別用。Demo Storeを選択するフラグではありません |

## Production setup checklist

本番接続は次の順序で行います。

1. 既存Supabase Project `dldfhhcechzhkbvlnzld` を再利用
2. migrationsを既存DBへ監査・適用（`supabase/README.md`の順序）
3. 既存DBのデータを確認し、空の環境に限って `seed.sql` を実行（既存案件・履歴へ盲目的に再投入しない）
4. Supabase Auth Userを作成（Dashboardまたは `npm run supabase:user -- --email ... --role ...`）
5. `public.users`のname / Role / activeを確認
6. `.env.local`へSupabase credentialsを設定
7. Applicationを起動
8. Designer loginを確認
9. Billing loginを確認
10. Accounting loginを確認
11. RLSでRole別の取得範囲を確認

Supabase接続後はlocalStorageや `.data/runtime/db.json` を業務データの保存先にしません。
日々の運用、Authユーザーの追加・停止・パスワード再設定、NEEDS_REVIEW、
障害時、バックアップ・復旧は [`docs/OPERATIONS.md`](docs/OPERATIONS.md) にまとめています。

## Invoice PDF

Billingで「請求書を発行」を押すと、請求データを確定してA4のSwiss Editorial PDFを生成し、保存します。AccountingまたはArchiveの請求書詳細から同じPDFをいつでも表示・保存できます。住所、税番号、銀行情報など未登録の情報はPDFへ追加しません。

## Current MVP Scope

- クライアントは **Ringer Hut** と **DAISHIN**（追加・改名・非表示に対応）
- 実データのみ。サンプル・架空の案件や金額は入れていません
- Productionの現在の請求対象：`RH Kids Promotion / Correction / $15`（納品済み・請求待ち）。Previewには表示しません

## Importing past invoices

過去の請求履歴は CSV から取り込めます。**推測はしません** — 金額・請求済み/入金済みの事実が不明、矛盾、重複疑いの行は
`NEEDS_REVIEW` に入り、理由が一覧表示されます。請求済み/入金済みの事実が確認できていれば、請求書番号・請求日・入金日が不明でも
`null` のまま履歴に保持できます。同じ案件の後日追加作業は別の請求項目のまま保持されます。

```bash
npm run import:history -- history.csv "Ringer Hut"
```

列は [`supabase/history-template.csv`](supabase/history-template.csv) を参照（`project,date,description,amount,status,invoice_number,invoice_date,payment_date` など）。
月次照合形式（`client,month,project,billing_item,amount_usd,invoice_fact,payment_fact,target_status`）も取り込めます。月しか確定していない行は月バケットとして保持し、正確な作業日は不明のまま注記します。
実行するとローカルストアへ取り込み、Supabase 用の SQL も生成します。

## Remaining production prerequisites

- **Supabase Auth User**：実際の社内GoogleアカウントをAuthへ登録し、同じUUIDを `public.users` に明示登録して各ログインとRLSを確認します
- **Google / Cloudflare設定**：Google Provider、OAuth callback、Supabase build variablesはDashboard側で設定が必要です
- **Supabase migration確認**：既存データを確認してから未適用migrationを適用します。Ringer Hut 2〜8月の履歴71件は既存本番データを再投入しません
- 会計ソフト・銀行 API 連携、ファイル添付の実体
