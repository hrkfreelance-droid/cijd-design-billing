# CIJD Billing — NBC Rate Operations Handoff

このファイルを、NBC公式レート運用に関する現在の引き継ぎ正本とする。

## Canonical checkout

- Local repo: `/Users/hirokitoyoshima/Documents/Codex/2026-09-01/cijd-design-billing-ui-repo-hrkfreelance`
- GitHub: `hrkfreelance-droid/cijd-design-billing`
- Branch: `integrate-production-workspace`
- Cloudflare preview: `https://cijd-design-billing-preview.hrk-freelance.workers.dev/`
- 旧Desktop pathは廃止。今後この案件の作業場所として使用しない。

## NBC rate rules

- Official source: NBC/MEF USD/KHR response (`currency_id=USD`, `symbol=USD/KHR`) only.
- NBC公式Exchange Rate page: `https://www.nbc.gov.kh/english/economic_research/exchange_rate.php`
- `fetchAndStoreLatestOfficialRate`は取得成功時にeffective dateを問わず保存する。
- `getApplicableOfficialRate`はPhnom Penhの当日以前で最も新しいOfficial working-day rateだけを使用する。
- Future effective dateは保存するが、適用日までは使用しない。週末・休日は直近の有効なRateを使う。
- Invoice作成時のUSD / KHR / exchange rate / effective date / fetched-atは既存のsnapshotとしてfreezeし、後続のRate取得で変更しない。

## Refresh paths

- Cloudflare Cron: `35 9 * * 1-5`, `50 9 * * 1-5`, `5 10 * * 1-5`, `0 1 * * *`（UTC）。前3つはPhnom Penh 16:35 / 16:50 / 17:05、最後は08:00 safety check。
- Manual Refresh: `/api/exchange-rate/refresh`。Worker側で公式APIを取得・検証・保存し、browserからNBC/MEFへ直接アクセスしない。
- Manual Refreshはin-flight dedupeと45秒のserver-side cooldownを使う。cooldown再利用時は`fetchedAt`を更新しない。
- UIはRate date（適用日）とLast checked（最後に成功した公式API確認時刻）を別々に表示する。操作は小さいOfficialリンクとRefresh補助操作のみ。
- Refresh失敗時は保存済みRateを維持し、利用者には安全な短いメッセージだけを表示する。

## Verification at handoff

- NBC/MEF公式APIの実応答を確認済み: `valid_date=2026-09-02`, USD/KHR, `bid=ask=average=4047`。
- `npm run lint`: PASS
- `npm run typecheck`: PASS
- `npm run build`: PASS
- `npm run build:vinext`: PASS（Wrangler log fileはmacOS権限によりEPERM警告が出るが、build自体は完了）
- `npm test`: 29 passed, 3 skipped, 0 failed
- Cloudflare push: PASS。GitHub branch HEAD `c075087b903f7bc8a214aefdab0124d30e5809c9`。
- 固定URLの公開画面: PASS。最終HTTP statusはredirect後`200`。
- 固定URLでManual Refresh: PASS。`4,047 KHR/USD`、Rate date `2026-09-02`、Last checked `2026-09-02 11:20` Phnom Penh、成功表示を確認済み。
- 固定URLのOfficial link: PASS。hrefは上記NBC公式Exchange Rateページ、`target="_blank"`、`rel="noopener noreferrer"`。

## Scope guard

main、Netlify、実データ、既存Invoice、Secret、固定共有URLは変更しない。過去のUIレビュー・価格レビューhandoffは履歴資料であり、このファイルのCanonical checkoutを参照する。
