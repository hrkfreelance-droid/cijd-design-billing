# CIJD V5 Accounting: No invoice + safer project removal (2026-10-30)

Scope: Worker `cijd-design-billing-v5-preview`, V5 D1 only. V3/V4 remain unchanged.

## Workflow
- Accounting lists Design work already sent to Accounting. After selecting billings, user chooses **Create Tax Invoice** (existing process) or **No invoice · Mark issued**.
- No invoice writes one internal `NoInvoiceIssue` audit record plus billing allocations in one optimistic D1 transaction. It **does not** create a Tax Invoice, VAT, invoice number, PDF, a ledger invoice, or a payment. Not a tax document or proof of collection.
- No invoice records appear in a separate **Issued · No invoice** list under Accounting. User may **Reverse** with confirmation; reversal voids its allocations without erasing the record.
- Deletion is visible beside each Accounting project and in the project detail, and in the V5 Design detail. Confirmation precedes a **soft delete** of unbilled lines and their project.
- Server blocks deletion if any tax invoice, internal No invoice, allocation (even cancelled), legacy invoice, imported history, or project payment exists. Finance history is retained. V3 deletion route is unchanged.

## Compatibility
- V5 state is one extra JSON collection (`noInvoiceIssues`) through D1 persistence. Existing collections and archive schema are unchanged. **No migration required**.
- Existing Tax Invoice / deposit / final / payment engines untouched.
- Manual reversal is possible for No invoice. Actual Tax Invoices continue to use the existing separate Cancel process.

## Verification
- Unit suite: 189/189 PASS (2026-10-30).
- No invoice isolated unit tests: 4/4 PASS, including real Tax Invoice deletion refusal.
- New browser E2E: 2/2 PASS against isolated local D1.
- Deposit/Final Tax Invoice browser E2E: PASS.
- Existing broad V5 E2E: prior assertion for nav (3 items) was outdated; correct nav is Design/Accounting/Customers/Archive. Retest after updating.
- Typecheck, targeted lint and V5 build: PASS.

## Deployment safety
- Target Worker: `cijd-design-billing-v5-preview`.
- Current backup: `.data/backups/cijd-v5-before-ui-20261030.sql` **local only**, not Git-tracked. Contains business data; never commit/share.
- Previous deployed version ID (before change): `917cc7be-660d-4991-8353-c97cbdf27b8b`.
- Rollback code: `npx wrangler rollback 917cc7be-660d-4991-8353-c97cbdf27b8b --name cijd-design-billing-v5-preview`; no D1 schema rollback needed, new collection harmless under old code.
- Before/after `GET /api/state` counts and tax total must match after deploy (no business writes).
