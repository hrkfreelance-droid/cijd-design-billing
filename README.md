# CIJD DESIGN Billing

CIJD DESIGN の案件・請求・入金管理 Web アプリ。
制作と請求を別のワークスペースに分け、その境界を **納品** に置いています。

## Preview

現在、公開 Preview は停止中です。Netlify への操作はユーザーの明示的な許可があるまで行いません。
ローカルでの起動方法は [Local Development](#local-development) を参照してください。

正本Repositoryに設定されていた GitHub Pages Preview の案内は保持しています。
[Open GitHub Pages Preview](https://hrkfreelance-droid.github.io/cijd-design-billing/)

この統合branchでは公開・deployは実行していません。Pages用の設定は正本起点のまま保持し、業務用のserver/API機能はローカルで検証します。

> 以前公開した `preview--cijd-billing.netlify.app` は旧バージョンのままです（役割分離・納品ゲート・Telegram は含まれていません）。

## Overview

```
Designer                              Office
────────────────                      ────────────────
作る  →  納品する      ──DELIVERED──▶  請求する → 入金確認 → 領収書 → 完了
```

納品前の案件は請求担当から見えません。**Office に出ているものは、すべて納品済みで請求してよいもの**です。

## Features

**Designer（`/designer`）**
- Today / Projects / Delivered / Archive
- 案件と請求項目の登録、`納品済みにする` の実行、`✓ 納品済み` の表示
- 請求書・入金・領収書は表示も操作もしない

**Office（`/office`）**
- Billing（請求待ち）/ Payments（入金待ち・領収書・完了）/ Archive
- 納品済みの項目だけが請求候補に出る
- Invoice Number は請求書発行時に入力（必須・重複禁止）

**守っているルール**
- `productionStatus !== DELIVERED` の項目は、請求待ちにも Invoice にもできない（UI・API・データ層すべてで拒否）
- 請求済み・入金済みの項目は編集・削除・再請求ができない
- 同じ請求書番号は登録できない。入金済みへの再入金確認はエラー
- 請求・入金の取り消しは確認付きで、履歴は消さずに残す

**Telegram**
- 案件登録：`RH New Menu Poster` → Ringer Hut の案件として `IN_PROGRESS` 登録
- 納品：`RH New Menu Poster 納品済み` または直前の案件に対して `納品済み`
- 対象が特定できない場合は候補を返して番号で選択させる（推測で更新しない）
- 納品時に請求担当へ通知。**通知の失敗で納品自体が失敗することはありません**（記録して再送可能・二重送信防止つき）

## Access Control

| Role | 見られるもの |
| --- | --- |
| `DESIGNER` | Designer 全画面、納品操作 |
| `BILLING` | 請求待ち、Invoice 作成、Invoice Archive、納品通知の再送 |
| `ACCOUNTING` | 入金待ち、領収書、完了、Archive |
| `ADMIN` | 全画面（ワークスペース切替つき） |

Navigation を隠すだけではありません。`/designer` と `/office` はサーバー側でも判定してリダイレクトし、
API は `GuardedRepository` を通すため、**権限外のデータはそもそも返りません**
（例：BILLING の `/api/state` に未納品の案件・項目は含まれない）。

認証は Supabase Auth を設定すればメール＋パスワードのサインインに切り替わります（未設定時は開発用の担当選択）。
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

初回起動時に `.data/db.json` が作成されます。リセットは削除して再起動。
サインイン画面で担当（Hiroki / Billing Staff / Accounting / Admin）を選ぶと、Role ごとのワークスペースに入ります。

開発時にSupabase credentialsが無い場合は画面に `LOCAL MODE` と表示されます。
`NODE_ENV=production` ではSupabase credentialsが無い場合にデータ層がfail closedし、
localStorageや `.data/db.json` を業務DBとして使いません。接続後は開発者とAdminに
`PRODUCTION / SUPABASE` と表示されます。

| コマンド | 内容 |
| --- | --- |
| `npm run build` / `npm start` | 本番ビルド・起動 |
| `npm run lint` / `npm run typecheck` | 静的チェック |
| `npm test` | Playwright（役割分離・納品ゲート・請求〜入金・Telegram） |
| `npm run test:import` | 過去履歴Importの判定・リンクテスト |
| `npm run telegram` | Telegram Bot（long polling。公開 URL 不要） |
| `npm run import:history` | 過去請求履歴の CSV 取り込み（後述） |
| `npm run shots` | 主要画面のスクリーンショット出力 |

`npm test` は専用ポートと使い捨てデータでサーバーを起動するため、実行前に `npm run dev` を停止してください。

## Environment Variables

`.env.example` をコピーして `.env.local` を作成してください。`.env*` は `.gitignore` 済みで、**Secret はコミットしません**。

| 変数 | 用途 |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Bot トークン（@BotFather） |
| `TELEGRAM_WEBHOOK_SECRET` | Bot → アプリ間の共有シークレット。未設定なら Bot 用エンドポイントは無効 |
| `TELEGRAM_BILLING_CHAT_ID` | 納品通知の送信先（ダイキテラシマ）。**未確認のため未設定。ID をここに入れるだけで有効になります** |
| `TELEGRAM_ACTOR` | Telegram から登録した際に記録する担当名（既定：`Hiroki`） |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 設定すると Supabase（DB + Auth）に切り替わります |
| `SUPABASE_SERVICE_ROLE_KEY` | サーバー専用。Telegram エンドポイント（ブラウザセッションを持たない）で使用 |
| `CIJD_DATA_FILE` | ローカル JSON ストアの保存先（既定：`.data/db.json`） |
| `NEXT_PUBLIC_DEMO_MODE` | `1` でブラウザ内デモデータに切り替え（公開 Preview 用。API routes は無効化） |

## Production setup checklist

本番接続は次の順序で行います。

1. Supabase Projectを作成
2. migrationsを実行（`0001_init.sql` → `0002_rls.sql` → `0003_functions.sql`）
3. `seed.sql`を実行
4. Supabase Auth Userを作成
5. `users`へRoleを割り当て
6. `.env.local`へSupabase credentialsを設定
7. Applicationを起動
8. Designer loginを確認
9. Billing loginを確認
10. Accounting loginを確認
11. RLSでRole別の取得範囲を確認

Supabase接続後はlocalStorageや `.data/db.json` を業務データの保存先にしません。

## Telegram setup checklist

納品通知の外部接続設定は `TELEGRAM_BOT_TOKEN` と
`TELEGRAM_BILLING_CHAT_ID` です。受信endpointを保護するlong-polling runnerには
`TELEGRAM_WEBHOOK_SECRET`も必要です。Chat ID未設定時は送信せず、`SKIPPED` または
`FAILED` を `notification_logs` に記録し、Officeから再送できます。

BotはProject登録、納品、Billing handoffまで処理します。実Botの起動は
`npm run telegram` です。

## Current MVP Scope

- クライアントは **Ringer Hut** と **DAISHIN**（追加・改名・非表示に対応）
- 実データのみ。サンプル・架空の案件や金額は入れていません
- 現在の請求対象：`RH Kids Promotion / Correction / $15`（納品済み・請求待ち）

## Importing past invoices

過去の請求履歴は CSV から取り込めます。**推測はしません** — 金額・請求済み/入金済みの事実が不明、矛盾、重複疑いの行は
`NEEDS_REVIEW` に入り、理由が一覧表示されます。請求済み/入金済みの事実が確認できていれば、請求書番号・請求日・入金日が不明でも
`null` のまま履歴に保持できます。同じ案件の後日追加作業は別の請求項目のまま保持されます。

```bash
npm run import:history -- history.csv "Ringer Hut"
```

列は [`supabase/history-template.csv`](supabase/history-template.csv) を参照（`project,date,description,amount,status,invoice_number,invoice_date,payment_date` など）。
実行するとローカルストアへ取り込み、Supabase 用の SQL も生成します。

## Not Implemented Yet

- **Ringer Hut の 2〜8 月の過去請求履歴**：実データ未受領のため未投入。上の import で1コマンドです
- **Supabase プロジェクト本体**：SQL・RLS・関数・seed・接続コードは完成済み。credentials 設定後に実接続の検証が必要
- **納品通知の送信先**：ダイキテラシマさんの Chat ID 未確認（架空値は入れていません）
- Invoice PDF、会計ソフト・銀行 API 連携、ファイル添付の実体
