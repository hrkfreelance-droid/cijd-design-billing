# V5 Tax Invoice migration and work areas — 2026-10-07

Preview: https://cijd-design-billing-v5-preview.hrk-freelance.workers.dev/office-v5
Tax workspace: https://cijd-design-billing-v5-preview.hrk-freelance.workers.dev/office-v5/tax-invoices

## Deployment and preservation

Only `cijd-design-billing-v5-preview` and its D1 `57f59023-c720-4abc-96af-505449c8ac9b` were changed. Additive migration `0004_v5_tax_history.sql` creates an immutable, unique invoice-number registry, seeded from the existing invoice archive. Existing projects require no category backfill: absent `workType` resolves to DESIGN. Each pre-existing persisted row was compared with the post-import D1 export and remained unchanged. Projects 74, billing items 118, ledger invoices 49, invoice items 59, allocations 12 and invoice payments 2 are unchanged. V3/V4 deployment histories were identical before and after.

Source supplied: `Tax Invoice CIJD 2026.xlsx` (request text mentioned `(2)`, but the explicitly attached Desktop file was used).
SHA-256: `4c1a775cadd6eecb31d9b27fb0b06a0ac9038583030b29f16162ea4296dbdcb4`.

## Migration results

- 79 source worksheets and 79 related drawing parts; 1008 text shapes inspected.
- All 79 sheets staged with cells, formulas/cached values, relationship-based drawings, merged cells and original text.
- 13 customer records added, 68 historical invoices added; resulting customers 18 and tax invoices 71.
- One explicitly cancelled source sheet is included in the two conflicting 045 sheets. It remains visible as Conflict + Cancelled; its number remains consumed. It was not converted into a fabricated normal invoice.
- Two conflicts; nine Needs review (8 KHR arithmetic mismatches and 1 malformed displayed invoice number). Source values were not corrected.
- Missing source fields by sheet: telephone 35; Khmer company name 14; English address 7; Khmer address 1; VATIN 1. Dates, rates and English company names were recovered for every sheet. Two missing rate labels have explicit matching in-workbook template cell/style evidence; one remains Needs review because its total mismatches.
- Source displayed highest: CIJDTI2026080. Existing stored highest: CIJDTI2026083. Suggested next: CIJDTI2026084, unreserved until issue.
- Missing source sequence numbers: displayed 016/044/054; no sheet 054. Sheet 016 displays malformed `CIJDTI2026005.` and sheet 044 displays duplicate 045. Zero-width characters remain preserved in raw source.
- Re-import: 79 skipped, zero new customers/invoices/accounting entries.
- Existing short customer names and differing master details are flagged, never fuzzy-merged or overwritten. Historical collections/issue timestamps are explicitly UNKNOWN, not treated as unpaid.

## Daily operation

Registered customer selection fills both company names/addresses, phone and VATIN. Search supports name/VATIN/phone; quick create/edit is available in the invoice editor. Drafts preserve incomplete inputs without allocating numbers. Issuing validates the current date/rate/items and uses atomic D1 reservation; cancellation keeps its consumed number. An NBC rate is accepted only when it matches the stored rate for that invoice date. Missing official dates allow explicitly manual rates.

Work Type switches the complete work area between Design and Other Business, remounting the board to clear selections/modals. New jobs explicitly persist DESIGN or OTHER_BUSINESS through a V5-only permission-checked endpoint. Existing job fields are untouched. Accounting remains shared, grouped by category; Archive separates Design/Other Business/All. Customers and invoice numbering stay shared. Issued invoices retain their source work categories; unlinked or multiple-category invoices use a Shared grouping without an inferred category.

## Verification

- 180 Node unit tests passed, including concurrent issue, uniqueness rollback, cancelled/reserved numbering, idempotent import/drafts and shared numbering across both work types.
- 2 package-parser tests passed, including nonsequential worksheet/drawing relationships.
- Typecheck passed (`--types node,react,react-dom`, avoiding pre-existing duplicate ambient type directories).
- V5 lint: zero errors, one pre-existing navigation warning. Vinext V5 build passed. `git diff --check` passed.
- Local actual browser: VATIN selection/autofill, quick customer create/edit, Draft save/resume, item add/remove, NBC/manual date rates, totals, Issue/Cancel/next number, and Other Business create/edit/Ready/Accounting handoff passed.
- Deployed actual browser: preserved Design jobs, empty separate Other Business area, Accounting/Archive classification, source history/customer autofill, next 084, desktop 1280x900 and mobile 390x844 basic QA passed. Browser warnings/errors: none.
- Main Preview routes and history/number/draft APIs returned 200. No live QA invoices or jobs were created; real numbering remains 084.
- Temporary V5_TAX_IMPORT_TOKEN was revoked after import. Import endpoint returns 404.

## Operations evidence / rollback

Private, ignored SSD evidence is in `work/tax-migration/`: `v5-pre-deploy.sql`, `v5-after.sql`, `final-plan.json`, `live-import-result.json`, `live-readback.json`, test/build/deploy logs, before/after V3/V4 deployment lists and screenshots. These include source business data and must not be committed or published.

The pre-change V5 Worker version is `edde309f-68a5-4b9f-b19a-be8705e511d3`; the code deploy version was `2ff27b5f-a704-4145-91d0-4d5956d1112a` (secret revocation creates a later version). Code rollback and data rollback are separate decisions. Additive tables may remain during a code rollback. Do not restore or delete live records without reconciling any new work created after the saved backup.

Next user action: open the Work Type selector for new Other Business work; review the 11 retained Conflict/Needs review source sheets from Tax Invoices → Import history.
