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
Numbers: `CIJDTI{year}{seq}`, continuing after the paper series (2026 starts at 081,
2027 restarts at 001). Assigned by the server, **immutable, never reused**. Clients whose
name starts with `TEST` get their own `TEST-CIJDTI{year}{seq}` series, so tests never
consume a real number. Cancel keeps the record and its number; nothing is ever deleted.

PDF: the V4 layout, plus Discount, Deposit and Balance Due rows (Khmer labels
បញ្ចុះតម្លៃ / ប្រាក់កក់ / ប្រាក់ត្រូវបង់នៅសល់) and a larger signature area. These rows take the place
of empty ruled rows, so an invoice with up to 10 lines prints on **one A4 page**. With
more lines the sheet grows (`.long`) and prints on several pages, with the table header
repeated and the signatures kept together.

## Invoice management (IMS, 2026-09-30)

Model (`src/lib/types.ts`, `src/lib/billing-v5/ontology.ts`, `invoicing.ts`):
Customer · Product · Billing (project) · Billing line · Invoice · Invoice item ·
BillingAllocation · InvoicePayment (DEPOSIT | PAYMENT) · ExchangeRate · InvoiceRevision.

- **Masters**: Customer (code C0001…, same id as the V3 client) and Product (P0001…).
  A free invoice line is added to Products only when the user answers "Save to Product
  List?" — never automatically.
- **One customer per invoice**, several billings allowed (`DIFFERENT_CUSTOMER` refused).
- **Partial billing**: an item may bill part of a line ($1000 → 300/300/400). The server
  refuses over-allocation and double billing inside one Store transaction (optimistic
  version lock ⇒ race safe). Billing state: UNBILLED / PARTIALLY_INVOICED /
  FULLY_INVOICED / LEGACY_BILLED (billed in V3, not eligible) / NOT_READY.
- **Discount** FIXED or PERCENT, **before VAT** — CIJD accounting policy confirmed
  2026-09-30 (`DISCOUNT_VAT_POLICY = "DISCOUNT_BEFORE_VAT"`, `calculation.ts`):
  Subtotal → Discount → Taxable Amount → VAT 10% → Grand Total → Deposit / Payments →
  Balance Due. e.g. $100 − 10% = $90 taxable, VAT $9, Grand Total $99; deposit $30 →
  Balance Due $69 (VAT stays $9). A deposit is never a discount. The discount cannot
  exceed the subtotal (the server refuses it). Invoices without a discount: VAT 10%
  exactly as before. Issued invoices keep their stored values; nothing is recalculated
  except by an explicit edit. The PDF shows the Discount row only when used.
- **Deposit** on the invoice = a DEPOSIT payment; printed as Deposit, Balance Due =
  Grand Total − Deposit. Separate from billing allocation.
- **Exchange rate follows the invoice date** (`officialRateForDate`, ontology.ts):
  EXACT = stored NBC rate with valid_date = invoice date; IN_EFFECT = the previous
  valid_date, only if NBC was seen still reporting it as latest on/after the invoice date
  (Phnom Penh). **No look-back window.** Otherwise the editor says so and the rate is
  entered by hand, saved as MANUAL with the invoice date (`exchangeRateForDate`,
  `exchangeRateBasis`). MANUAL is refused when NBC has the rate (`RATE_AVAILABLE`). An edit
  that keeps the date never changes the saved rate. NBC/MEF's API only returns the latest
  rate, so V5's cron (and the editor, for today) stores it daily.
- **Invoices marked paid before IMS** (ledger entry PAID) count as collected: a
  read-only derived payment (`ledger:<id>`), nothing written.
- **Edit**: every issue/edit/cancel writes an immutable revision (`v5_invoice_revisions`,
  insert-only with no-update/no-delete triggers) holding the previous snapshot. The
  number never changes; the first issue stays in `v5_tax_invoice_archive`.
- **Payments**: several per invoice; voided with a reason, never deleted; overpayment
  refused; Collected when paid ≥ total.
- **Invoice list**: search (number / customer / amount), year and status filters.
- Existing V5 invoices are back-filled on load (deterministic allocation and revision ids).
- UI: `/office-v5/accounting?view=to-invoice|invoices|customers|products`,
  editor modal `invoice-editor.tsx`, invoice page with Payments, Billings and History.
- Migration `migrations-v5/0002_v5_invoice_management.sql` (additive only), applied by
  `npm run deploy:v5` (`wrangler d1 migrations apply --remote`).

## Commands

```sh
npm run test:unit        # 160 unit tests (V3 + V5 calculation, store, invoicing on real SQLite)
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

## IMS deploy (authorised machine)

```sh
npx wrangler login
scripts/v5-ims-deploy.sh
```

Checks branch/HEAD/policy → pushes the rollback tag (never forced) → records V5/V3/V4
Worker versions, the V5 D1 id and migrations, and V5's data (`/api/state`, GET) →
`scripts/deploy-v5.sh` (migration 0002, Worker, smoke) → reconciliation
(`npm run v5:reconcile`: every existing record, invoice number, total, customer
snapshot, billing link and payment state unchanged) → live browser E2E (TEST data,
TEST- series) → reconciliation again → V3/V4 GET + versions unchanged. Stops at the
first failure and prints the rollback. Reports: `.data/v5-ims-deploy/<time>/`.

## Rollback (V5 only — V3 and V4 are never involved)

- IMS rollback point: branch `backup/v5-pre-invoice-management-20260930` (pushed) and
  tag `v5-pre-invoice-management-20260930` (local; push from an authorised machine).
  Redeploy that code with `npm run deploy:v5`. Migration 0002 only adds a table, so the
  old code runs on the migrated D1 unchanged.

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

- **Discount/VAT order: confirmed BEFORE_VAT** by CIJD accounting (2026-09-30).
- The PDF has no separate Taxable Amount row (its Khmer wording is not confirmed); the
  editor shows it. Add it once the Khmer label is confirmed.
- **QR — verified absent**: no QR asset, component, dependency or text in any branch
  (V2–V5, main, gh-pages); the V4 template (`v4-app/src/ui/invoice-document.tsx`) has
  only the logo image. Nothing was added. (The original .xlsx workbook's embedded
  images were not in the repository and could not be checked.)
- A weekend/holiday invoice date gets NBC's rate only if a check ran on that date
  (the daily 08:00 cron); otherwise it is entered by hand.

- **VAT not applicable** toggle prints VAT 0% (Khmer ០%). Default is 10%.
- **Balance** is commercial (Final total, before VAT).
- Unit price printed = stored Final unit when it reproduces the line amount, else amount ÷ qty
  to the cent (e.g. 500 × $0.31 printed, amount $156.00 kept).
- Access follows V3's pilot mode (`CIJD_PILOT_MODE=1`): anyone with the URL is admin.
