# Codex Price Review Handoff

## Scope

This hardening pass starts from `66c57bd` on `integrate-production-workspace`.
The protected untracked `history.csv` and the existing local verification data
were left untouched. No production Supabase data was changed.

## Price model

Current operational `PRINT` items use the structured
`price_review_status` field:

- `REVIEW_REQUIRED` — suggested or incomplete price; not invoiceable.
- `CONFIRMED` — a human confirmed the unit price and amount.
- `NOT_REQUIRED` — reserved for non-printing work and historical compatibility.

The UI no longer infers price certainty from note text. A current PRINT row
whose status is missing or invalid fails closed as `REVIEW_REQUIRED`; imported
history remains read-only and outside the current printing queue.

Changing print quantity, size, unit price, amount, or other print specification
clears the confirmation and returns the item to `REVIEW_REQUIRED`. The local
store and Supabase RPC paths record the change in `audit_logs`.

## Printing and invoice gate

Printing owns the final price review. Confirming a price does not complete
production. A current PRINT item reaches billing only after:

`production_status = DELIVERED`

and

`price_review_status = CONFIRMED`

The invoice operation enforces this rule in the local repository and the
Supabase SQL function. Creative work continues to use `COMPLETED`, with the
existing legacy `DELIVERED` records preserved.

## Database migration

`20260831120000_explicit_price_review_audit.sql` adds trigger-only audit entries
for newly suggested prices, direct structured price-review transitions, and
confirmation invalidation. It also closes the existing Billing update guard's
gap around PRINT specification and price-review columns, so Billing cannot
confirm a print price through a direct table update. It does not backfill or
rewrite existing business rows.

## Verification boundary

The test suite uses its isolated local store and `.next-test` runtime. No
GitHub push/write, Netlify access, deployment, or live Supabase mutation is
part of this handoff.
