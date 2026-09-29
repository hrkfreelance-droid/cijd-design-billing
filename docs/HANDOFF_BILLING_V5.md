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

- Implemented, unit-tested and E2E-verified **locally** (wrangler dev + local D1 + Chromium).
- **Not deployed**: this session had no Cloudflare credentials and its network policy
  blocks `api.cloudflare.com`, `*.workers.dev`, Supabase and NBC. Run `npm run deploy:v5`
  from a machine logged in to the CIJD Cloudflare account.
- Live V3/V4 could not be reached from the session to re-check them; nothing in this
  branch deploys to their Workers or touches their databases.

## Decisions to confirm

- **VAT not applicable** toggle prints VAT 0% (Khmer ០%). Default is 10%.
- **Balance** is commercial (Final total, before VAT).
- Unit price printed = stored Final unit when it reproduces the line amount, else amount ÷ qty
  to the cent (e.g. 500 × $0.31 printed, amount $156.00 kept).
- Access follows V3's pilot mode (`CIJD_PILOT_MODE=1`): anyone with the URL is admin.
