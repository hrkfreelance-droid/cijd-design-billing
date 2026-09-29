# CIJD Billing V5 — V3 + Accounting / Tax Invoice

Branch: `feature/billing-v5-accounting-integration` (from `feature/billing-v3` @ `8879f84`,
the commit behind the live `/office-v3`). Not branched from V4.

## Goal

V3's designer screens unchanged, plus one step after "Ready to bill":

```
Billing (V3, unchanged) → Accounting → Prepare Tax Invoice → Preview → Issue
  → Tax Invoice page (reopenable) → Print / Save PDF → back to Accounting
```

Routes: `/office-v5` (Billing), `/office-v5/accounting`, `/office-v5/archive`,
`/office-v5/tax-invoices/:id`.

## Data boundary

| | V3 | V4 | V5 |
|---|---|---|---|
| Worker | `cijd-design-billing-preview` | `cijd-design-billing-v4-preview` | `cijd-design-billing-v5-preview` |
| Config | `wrangler.jsonc` (unchanged) | `v4-app/wrangler.jsonc` | `wrangler.v5.jsonc` |
| Data | Supabase (live) | D1 `cijd-design-billing-v4-preview` | D1 `cijd-design-billing-v5-preview` (binding `V5_DB`) |

- The V5 Worker has **no Supabase variables**; `supabaseConfig()` returns null when
  `CIJD_V5_MODE=1`, and `getRepository()` returns the V5 store first. V5 cannot read or write V3 data.
- `/office-v5` redirects to `/office-v3` on any process that is not the V5 Worker.
- V5 starts empty (its own seed). Nothing was copied from V3 or V4.
- V5 runs V3's own rules engine (`Store`) over D1 (`src/lib/billing-v5/d1-persistence.ts`):
  one JSON row per collection, optimistic version lock, append-only `v5_audit_log`, and
  `v5_tax_invoice_archive` (insert-only, triggers refuse UPDATE/DELETE, unique invoice number).
- Migration: `migrations-v5/0001_v5_state.sql` — V5-only, additive. No V3/V4 migration touched.

## Calculation layer — `src/lib/billing-v5/calculation.ts`

One module for: pricing rules (named; `markup-band-v3` = 50/40/30%, per-line override),
AUTO/MANUAL Final, quantity, payments/balance, validation (ERROR vs WARNING), tax and
invoice numbering. Money rounds one way (`roundMoney`, half-up to the cent); tax totals
are summed in integer cents; KHR = USD × rate, half-up to the riel (V4's arithmetic).

- **Final mode** is stored (`billing_items.finalMode`, V5 rows). Rows without it keep the
  V3 reading exactly (inferred), so no existing price changes.
- Cost/markup change → Recommended moves; Final follows only when AUTO.
- Manual Final (even when equal to Recommended) stays MANUAL until "Use recommended".
- Quantity keeps a manual Unit Final; the line total becomes unit × qty.
- Payments: `projectPayments` (DEPOSIT / PARTIAL / FINAL). A V3 `depositAmount` is read
  as one DEPOSIT payment. Balance = Final total − non-voided payments (commercial, pre-VAT).
- Tax invoice lines = the designer's Final line amounts, unchanged. Subtotal must equal
  the project's Final total or issue is refused.

## Tax Invoice

Template = V4's `InvoiceDocument` (workbook sheet CIJDTI2026080): same Khmer/English
text, CIJD VATIN, bank details, signatures. Rendered only from the frozen record.
Khmer fonts are self-hosted (`@fontsource/noto-sans-khmer`, `@fontsource/moul`).
Numbers: `CIJDTI{year}{seq}`, continuing after the paper series (2026 starts at 081);
editable, unique in V5. Cancel keeps the record and its number.

## Commands

```sh
npm run test:unit        # 135 unit tests (108 V3 + V5 calculation + V5 store on real SQLite)
npm run dev:v5           # build V5 + fresh local D1 + wrangler dev on :8787
PW_EXECUTABLE=/path/to/chromium npm run test:v5:e2e   # full browser E2E against :8787
npm run deploy:v5        # deploy V5 (needs Cloudflare auth: wrangler login or API token)
```

`V5_BASE_URL=https://cijd-design-billing-v5-preview.hrk-freelance.workers.dev npm run test:v5:e2e`
runs the same E2E against the deployed V5 (it creates one test customer/project and issues
one invoice with the next number — run it on a fresh V5 database, before real use).

## Status (2026-09-30)

- V5 implemented; V3 import tool, deploy, smoke, deployed E2E and go-live script ready.
- All of it rehearsed **locally** (wrangler dev + local D1 + Chromium): import of a V3
  fixture → verify PASS → deployed-mode E2E PASS → verify PASS → smoke (V5 part) PASS.
- **Not deployed, real V3 data not yet copied**: the build session had no Cloudflare or
  Supabase credentials, and its network policy blocks `api.cloudflare.com`,
  `*.workers.dev`, Supabase and NBC. Run `scripts/v5-go-live.sh` on an authorised machine.
- Live V3/V4 not reachable from the session; nothing here deploys to or writes them.

## Verification (local, 2026-09-30)

- `npm run test:unit`: 142/142 pass (108 existing V3 + 34 V5, incl. importer on real SQLite).
- V5 browser E2E (`tests/v5/v5-e2e.spec.ts`): pass — 0 console errors, 0 failed requests.
- Existing V3 Playwright suite on this branch: 54 pass, 3 skipped, 3 fail. The same 3
  `billing-flow.spec.ts` tests (`designer ready tab…`, `invoice once, pay once`,
  `printing cost persists…`) fail identically on a pristine `feature/billing-v3`
  checkout, so they are pre-existing and not caused by V5.

## V3 → V5 data copy (one time)

`scripts/v5-import/v3-to-v5.ts` (`npm run v5:import`), core in `src/lib/billing-v5/v3-import.ts`.

- Reads V3 from Supabase REST with **GET only** (enforced in code; any other method or
  URL is refused), every table fully paged, row count checked against Supabase's own
  total (a short read aborts). Or reads a JSON dump (`--source-file`).
- Maps rows with V3's own mappers (`src/lib/supabase/rows.ts`), so V5 holds exactly what
  V3 shows. IDs kept. Prices, unit prices, quantities, costs, markups, memos, statuses,
  readiness, deposits, ledger entries, invoice links and payments copied as stored.
  Soft-deleted rows copied as deleted. **No `finalMode` written, nothing recalculated.**
- Unsafe records are listed: BLOCKING (duplicate/missing id, non-numeric money) stops
  the import; WARNING (orphans, unknown enum values, sub-cent amounts) are copied as is
  and listed.
- Writes only through `/api/v5/import`: V5 Worker only, requires the `V5_IMPORT_TOKEN`
  secret (absent = endpoint 404), and only into a V5 with **no business data**.
- Every run writes `v3-backup.json` (raw V3 rows), `v5-plan.json`, `report.md` under
  `.data/` (git-ignored; contains business data — keep it private).
- `--verify` compares every V3 client, project and line with V5 field by field
  (prices, memo, status, deposit, deleted flag). Records created later in V5 are listed
  as extra and allowed.

## Go-live (authorised machine)

```sh
npx wrangler login
export SUPABASE_URL=https://dldfhhcechzhkbvlnzld.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=…     # Supabase → Project Settings → API; used read-only
npx playwright install chromium
scripts/v5-go-live.sh
```

Deploy → smoke (V5 + V3 + V4) → V3 dry-run report (confirm) → import → verify →
deployed browser E2E (TEST data, TEST- invoice number, cleaned up) → verify again →
import token removed → smoke. Logs, reports and screenshots: `.data/v5-go-live/<time>/`.

Individual steps: `npm run deploy:v5`, `scripts/v5-smoke.sh <url>`,
`npm run v5:import -- [--target <url> --commit|--verify]`,
`V5_BASE_URL=<url> V5_EXPECT_IMPORTED=1 npm run test:v5:e2e`.

## Rollback (V5 only — V3 and V4 are never involved)

- Code: `npx wrangler deployments list --name cijd-design-billing-v5-preview`, then
  `npx wrangler rollback <version-id> --name cijd-design-billing-v5-preview`.
- Data: D1 Time Travel —
  `npx wrangler d1 time-travel info cijd-design-billing-v5-preview` and
  `npx wrangler d1 time-travel restore cijd-design-billing-v5-preview --timestamp <before the import>`.
  V3 still holds the originals; the import can be run again into an emptied V5.
- Start over: `npx wrangler delete --name cijd-design-billing-v5-preview` and
  `npx wrangler d1 delete cijd-design-billing-v5-preview`, then `scripts/v5-go-live.sh`.
- Close the import door at any time: `npx wrangler secret delete V5_IMPORT_TOKEN --name cijd-design-billing-v5-preview`.

## Decisions to confirm

- **VAT not applicable** toggle prints VAT 0% (Khmer ០%). Default is 10%.
- **Balance** is commercial (Final total, before VAT).
- Unit price printed = stored Final unit when it reproduces the line amount, else amount ÷ qty
  to the cent (e.g. 500 × $0.31 printed, amount $156.00 kept).
- Access follows V3's pilot mode (`CIJD_PILOT_MODE=1`): anyone with the URL is admin.
