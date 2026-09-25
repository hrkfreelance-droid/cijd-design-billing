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
A line's manual markup (markup_override, percent) replaces the band.
```

App side (done): `src/lib/billing-v2/pricing.ts` — shared by V2, V3, the
Printing screen and both repositories.

SQL side (NOT done — follow-up): the live recommendation functions still use
the old rule. Live has newer objects than this repository (Sep 12:
add_print_margin_override, print_margin_rpc, print_cost_basis_rpc — two
overloads each of `update_print_spec` / `review_print_price`,
`round_print_billing_price`, `*_with_margin`, `margin_override`,
print-cost-basis columns). Their bodies are not in any repository, so they
must be exported (`supabase/tests/billing-v3-pricing/live-schema-export.sql`)
and changed formula-only in a separate migration. Until then the Printing
screen's cost-based "Set price" (TS new rule vs SQL old rule) disagrees.
The app calls only the 7-arg `update_print_spec` and 8-arg
`review_print_price` (named `p_print_cost`).

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
- An edited markup is saved per line (`markupOverride`) and reopens as
  "35 % · Manual"; later cost changes recommend with it. "Use default"
  clears it back to the 50 / 40 / 30 band.
- Only "Use recommended" returns a manual line to AUTO.
- Unit prices are cents (`billing_items.unit_price` is `numeric(12,2)`).

## Storage

- Final Unit Price → existing `billing_items.unit_price`, written with the
  total by the new RPC `override_billing_unit_price` (API: `PATCH
  /api/billing-items/:id/billing-price` with `unitPrice`). It works inside the
  existing guards for ADMIN, DESIGNER, PRINTING and the service key (pilot);
  the existing guards refuse unit_price to BILLING/ACCOUNTING, and without the
  migration the function is missing — both fall back to the old amount-only
  override. The Qty rule holds either way: the unit price is read back as
  total ÷ qty when the stored one does not reproduce the total.
- Markup % → new nullable `billing_items.markup_override numeric(6,2)`
  (percent; NULL = band; 0–1000 check), written only by
  `set_billing_item_markup` (API: `PATCH /api/billing-items/:id/markup`,
  `{ markupPercent: number | null }`). It moves the recommendation only —
  `print_recommended_amount(cost, markup_override)` in SQL and
  `printSellingPriceFromCost(cost, markupOverride)` in the app — never a
  stored price. Locked for invoiced/paid and imported lines. Separate from
  the live gross-margin `margin_override numeric(5,4)`, which is untouched.
- Deposit → new nullable `projects.deposit_amount numeric(12,2)` (NULL = $0,
  `>= 0` check), written only by `set_project_deposit` (API: `PATCH
  /api/projects/:id/deposit`). Locked once the project has invoiced/paid work.

## Migration design

`20260925090000` is additive only: two nullable columns, four NEW functions,
no CREATE OR REPLACE of anything existing, no row writes, one transaction,
and a preflight that refuses to run if an expected object is missing or a new
name already exists (a second run is refused and changes nothing).

## Before merge / deploy (in this order)

1. Read-only export: run `live-schema-export.sql`; save result 1 as
   `supabase/tests/billing-v3-pricing/live-schema/functions.sql`.
2. Write the follow-up migration that aligns the live recommendation
   functions (formula only) and re-run `run.sh` against the real definitions.
3. Read-only snapshot: `live-snapshot.sql` (data) and `schema-fingerprint.sql`
   (definitions); keep both outputs.
4. Apply `20260925090000` (then the follow-up).
5. Re-run both snapshots: data must match; schema must differ only by the
   follow-up's intended functions.
6. Confirm the Cloudflare production branch (Workers & Pages →
   cijd-design-billing-preview → Settings → Build → Branch control).
7. Merge into `feature/billing-v3`; verify the live `/office-v3`.

## Verification

- `npm run typecheck`, `npm run test:unit`, `npx eslint`, `npm run build:vinext`
- `tests/billing-v3-pricing.spec.ts` (Playwright, throwaway local store)
- `supabase/tests/billing-v3-pricing/run.sh` — local Postgres 16 with the
  repository chain + the live Sep 12 columns and function names: no row and
  no schema object changes, a second run is refused, the new functions behave
  per role, and the print-cost basis is never written.

## Known, pre-existing (not changed here)

- `review_print_price` raises an enum-cast error on `price_review_status`
  (same on a DB without this migration).
- `current_role_name()` is SECURITY INVOKER while the `users_read` policy
  calls it — recursion for signed-in roles on plain Postgres; live runs in
  pilot mode through the service key.
- `tests/billing-flow.spec.ts` 306 / 385 / 664 fail identically on `836813b`.
