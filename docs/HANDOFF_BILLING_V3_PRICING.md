# Billing V3 Pricing — Handoff

## Goal

Markup-based recommendation, editable markup, Final Unit Price / Final Total
overrides that survive Qty changes, and a project Deposit with Remaining
Balance — without changing any stored value.

Branch: `feature/billing-v3-pricing` (from `feature/billing-v3` @ `836813b`).
Not merged, not deployed, migration not applied.

## Pricing rule

```
Recommended Total = round(Cost Total × (1 + markup), 2)
Cost Total <= $50 → +50%   <= $100 → +40%   otherwise → +30%
```

Replaces `cost / (1 - margin)` rounded up to $5, everywhere it is calculated:
`src/lib/billing-v2/pricing.ts` (shared by V2/V3/Printing and both
repositories) and SQL `public.print_recommended_amount`, used by
`ensure_print_price_review`, `update_print_spec`, `review_print_price`.

Stored prices are never recalculated. A line priced under the old rule opens
in V3 as a manual price (Final unchanged, Recommended shows the new rule).

## V3 line pricing (`src/components/billing-v3/item-draft.ts`)

One source per line — `finalMode`:

| Mode  | Source                | Derived               |
|-------|-----------------------|-----------------------|
| AUTO  | Recommended           | Final Total, Unit     |
| UNIT  | Final Unit Price      | Total = Unit × Qty    |
| TOTAL | Final Total (typed)   | Unit = Total ÷ Qty    |

- Qty change on a manual line keeps the unit price (TOTAL becomes UNIT).
- Markup edit moves Recommended; only an AUTO Final follows it.
- Only "Use recommended" returns a manual line to AUTO.
- Unit prices are cents (`billing_items.unit_price` is `numeric(12,2)`).

## Storage

- Final Unit Price → existing `billing_items.unit_price`, written with the
  total by the new RPC `override_billing_unit_price` (API: `PATCH
  /api/billing-items/:id/billing-price` with `unitPrice`). Without the
  migration the server falls back to the old amount-only override.
- Deposit → new nullable `projects.deposit_amount numeric(12,2)` (NULL = $0,
  `>= 0` check), written only by `set_project_deposit` (API: `PATCH
  /api/projects/:id/deposit`). Locked once the project has invoiced/paid work.

## Before merge / deploy (in this order)

1. Live snapshot: run `supabase/tests/billing-v3-pricing/live-snapshot.sql`
   (read-only) in the Supabase SQL editor; keep the output.
2. Apply `supabase/migrations/20260925090000_billing_v3_markup_unit_price_deposit.sql`.
3. Run the snapshot again — every fingerprint must match step 1.
4. Merge into `feature/billing-v3` (this pushes to the auto-deployed branch).
5. Verify the live `/office-v3`: pricing panel, deposit save + reload,
   Qty 180→181 / 180→200 on a manual unit price.

Deploying the code before step 2 is safe for prices (falls back), but saving
a deposit fails until the migration exists.

## Verification

- `npm run typecheck`, `npm run test:unit`, `npx eslint`, `npm run build:vinext`
- `tests/billing-v3-pricing.spec.ts` (Playwright, throwaway local store)
- `supabase/tests/billing-v3-pricing/run.sh` — local Postgres 16: migration
  changes no row, is idempotent, and the new functions behave per role.

## Known, pre-existing (not changed here)

- `review_print_price` raises an enum-cast error on `price_review_status`
  (same on a DB without this migration).
- `current_role_name()` is SECURITY INVOKER while the `users_read` policy
  calls it — recursion for signed-in roles on plain Postgres; live runs in
  pilot mode through the service key.
- `tests/billing-flow.spec.ts` 306 / 385 / 664 fail identically on `836813b`.
