# CIJD DESIGN Billing

CIJD DESIGNの案件・請求・入金管理Webアプリ。現在は安全なmock/local dataで主要業務フローを確認できます。

### Preview

Preview URLはNetlify公開後に設定します。

### Overview

案件の進行状況、請求候補、Invoice、入金、領収書状態をひとつの静かなワークスペースで管理します。

### Features

- Today / Projects / Billing / Archive
- Client切替、Client追加・編集
- JA / EN、Light / Dark、設定のlocalStorage保存
- 請求候補の選択、Invoice作成、Invoice番号の重複防止
- 入金確認、領収書状態、Archive復元確認
- 320px以上のresponsive mobile UI

### Tech Stack

- Next.js 14 App Router
- React 18 / TypeScript
- CSS design tokens、local repository abstraction
- Supabase接続を後から差し替え可能なデータ構造

### Local Development

```bash
npm install
npm run dev
```

Production buildの確認：

```bash
npm run build
npm run start -- --hostname 127.0.0.1 -p 4176
```

### Environment Variables

Current MVPでは環境変数不要です。Supabase接続時にのみ、秘密情報を`.env.local`へ設定してください。`.env`系ファイルはGitへcommitしません。

### Current MVP Scope

Mock/local dataによる案件・請求・入金管理と、将来用の`POST /api/projects` APIを含みます。公開Previewにも本番データやSecretは含めません。

### Not Implemented Yet

Supabase本番接続、認証・RBAC、Telegram Bot、PDF生成、ファイルアップロード、会計ソフト連携、通知、分析は未実装です。
