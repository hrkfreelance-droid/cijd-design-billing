# CIJD DESIGN Billing 運用ランブック

この文書は、Supabase接続後に社内で毎日使うための短い手順です。業務データの正本はSupabaseです。`localStorage`、`.data/db.json`、`.data/runtime/db.json`は本番台帳として使いません。

## 毎日の流れ

1. DesignerがClient / Project / Billing Itemを登録する。
2. 制作・印刷が進む間、Billing / Accountingは`進行状況`でClient → Project → Itemの状態だけを確認する。
3. 制作が終わったらDesignerが完了または納品済みにする。請求待ちになった項目はBillingが選択して請求する。
4. Accountingが入金と入金日を確認する。
5. 必要な場合だけ領収書を送付済みにし、完了した請求はArchiveで確認する。

未納品の項目は請求画面・API・Repository・Supabase RLS / DB制約の各層で請求対象になりません。進行状況ではREAD ONLYで確認できます。追加作業は既存項目を上書きせず、新しいBilling Itemとして登録します。

## Authユーザーの管理

最初の4人は、実際の社内メールアドレスを確認してから作成します。Supabase Dashboardまたは、信頼できる管理者端末で次を実行します。

```bash
SUPABASE_SERVICE_ROLE_KEY='(local shell only)' \
  npm run supabase:user -- --email person@example.com --role DESIGNER --name 'Hiroki'
```

パスワードはCLIが非表示入力します。`SUPABASE_SERVICE_ROLE_KEY`はブラウザ、Git、README、shell historyへ出しません。

- 新しい社員：Auth Userを作成し、`public.users`のname / role / activeを確認する。
- 退職・一時停止：`public.users.active = false`にしてから、必要に応じてDashboardでAuthセッションを失効させる。業務プロフィールは削除しない。
- Role変更：管理者が`public.users.role`を変更する。本人のCookieやJWTの値はRoleの根拠にしない。
- パスワード忘れ：Sign in画面の「パスワードを忘れた場合」から再設定する。メール配信とredirect allow-listはSupabase Auth側で先に設定する。

管理者がSQLで状態を確認・変更する場合：

```sql
select id, name, role, active from public.users order by name;
update public.users set active = false where id = '<auth uid>';
update public.users set role = 'ACCOUNTING' where id = '<auth uid>';
```

パスワードはSQLや`public.users`に保存しません。ユーザー追加・変更はaudit logに残ります。

## NEEDS_REVIEW

`NEEDS_REVIEW`は、金額、請求済みか、入金済みかに確定情報がない場合、矛盾、重複疑いがある場合に使います。請求書番号・請求日・入金日だけが不明でも、請求または入金の事実が確定していれば履歴は保持できます。不明値は`null`です。

- Designerは完了・納品の事実を確認する。Billing / Accountingは進行状況で納品前もREAD ONLY確認できる。
- BillingはReview欄と元資料を照合し、金額と請求事実が確認できるまで請求しない。
- 入金事実が確認できないものは、請求済みでも`INVOICED`のままにし、`PAID`にしない。
- 推測で金額、日付、PAIDを補わない。Invoice Numberはアプリが自動生成する。
- 既存の請求・入金済みデータを削除して修正しない。確認できた事実はImportまたは管理者手順で監査可能な形で追加する。

## 間違った請求・入金

- Invoiceが間違っている：Invoice詳細で請求を取り消す。項目は請求待ちに戻るため、正しいInvoice Numberで作り直す。Invoice Numberは再利用しない。
- 入金を誤登録した：Accountingが入金を取り消す。Paymentは削除せず、取り消し履歴を残す。
- すでにPAIDの請求を修正する場合：先に入金を取り消し、必要な確認を記録してから請求の修正を行う。

## Telegram

納品処理が先にDBへ保存され、その後にBilling handoffと通知を行います。通知失敗で納品を巻き戻しません。

- 外向きの納品通知に必要なのは`TELEGRAM_BOT_TOKEN`と確認済みの`TELEGRAM_BILLING_CHAT_ID`。
- long pollingの受信runnerには、アプリとの共有用に`TELEGRAM_WEBHOOK_SECRET`も必要。Supabase modeのrunnerでは`SUPABASE_SERVICE_ROLE_KEY`も必要。
- Chat IDは推測しない。未設定なら送信せず、`SKIPPED`または`FAILED`を`notification_logs`に保存する。
- Officeの通知欄から再送する。dedupe keyで同じ納品を二重送信しない。
- Botが止まった場合は、まず`TELEGRAM_BOT_TOKEN`、Chat ID、shared secret、プロセスログを確認する。DB上の納品状態は手で戻さない。

起動コマンド：

```bash
npm run telegram
```

## 障害時

- Supabaseが利用できない場合：請求・入金・Role変更の操作を止め、エラー時刻と対象Invoiceを記録する。Production modeでlocal JSONへ切り替えて業務を続行しない。
- 復旧後：まずログイン、RLS、Current Item、未納品請求ゼロを確認し、その後に保留操作を一件ずつ再実行する。
- データの不整合を見つけた場合：削除や直接上書きで隠さず、対象IDと事実を保全して管理者にエスカレーションする。

## バックアップと復旧

Supabaseの自動バックアップ、保持期間、Point-in-Time Recoveryの利用可否は契約プランと設定で変わります。管理者はSupabase Dashboardの現在の設定を確認し、少なくとも定期的な論理バックアップをRepository外の安全な保管場所へ保存します。

リンク済みプロジェクトからの例：

```bash
npx supabase db dump --linked --file /secure/backup/location/cijd-YYYY-MM-DD.sql
```

バックアップファイル、DBパスワード、接続文字列、Service Role KeyはGitに入れません。復旧は、まずバックアップの読み取り確認と対象範囲を二人で確認し、業務時間外に実施します。復旧後はmigration履歴、clients 2件、Current Item、請求書・入金件数、RLS、Role別ログインを確認します。

公式資料： [Supabase Backups](https://supabase.com/docs/guides/platform/backups) / [Supabase CLI backup and restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
