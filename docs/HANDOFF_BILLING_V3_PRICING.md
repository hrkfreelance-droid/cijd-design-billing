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

SQL side: `20260925100000` aligns the ACTIVE paths — the BEFORE INSERT
trigger `ensure_print_price_review`, the 7-arg `update_print_spec` and the
8-arg `review_print_price` (the overloads the app calls, named `p_print_cost`)
— formula only, via `print_markup_recommended_amount(cost, markup_override)`.
The 8-arg review also gets the enum cast that made it fail at runtime (the
fix 20260902100000 gave the 7-arg overload).

Left untouched as compatibility (own established semantics): the Sep 2
`update_print_spec` (6 args) / `review_print_price` (7 args) /
`set_billing_price` / `round_print_billing_price`, and the Sep 12
`update_print_spec_with_margin`, `review_print_price_with_margin` (gross
margin via `margin_override`) and `update_print_spec_with_costs`
(print-cost basis). `margin_override` stays a separate gross-margin field.

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

## Migrations

1. `20260925090000` — additive: `projects.deposit_amount`,
   `billing_items.markup_override`, four NEW functions. No CREATE OR REPLACE,
   no row writes, one transaction; preflight refuses if anything it creates
   already exists.
2. `20260925100000` — alignment: replaces 7 functions (the 3 active
   recommendation paths, both guards, the 2 RPCs from step 1). Its preflight
   compares `md5(prosrc)` of every function it replaces with the exact live
   body it was written against (Sep 9 bodies, which the live
   `maintain_print_price_review` behaviour confirms are the ones in force);
   any difference aborts the whole migration with nothing changed.

Guards after `20260925100000`:
- `markup_override` changes only through `set_billing_item_markup`
  (announces `cijd.billing_markup`) — for BILLING, ACCOUNTING and PRINTING.
- A direct BILLING update may change `billing_status`, `billing_override`
  and `updated_*` only; every other column (print-cost basis,
  `billing_price_manual`, `service_type`, `margin_override`,
  `markup_override`, …) is refused.
- Inside a billing-price override, `unit_price` may change only when
  `override_billing_unit_price` announces `cijd.billing_unit_price` — so
  BILLING and ACCOUNTING can now store the Final Unit Price too.
- Imported-history and invoiced/paid locks unchanged.

## Release order

1. Read-only: `live-snapshot.sql` (data) and `schema-fingerprint-all.sql`.
2. Apply `20260925090000`, then `20260925100000`.
3. Re-run both: data identical; schema differs only by the new objects of
   step 1 and the 7 functions of step 2.
4. Merge into `feature/billing-v3` (Cloudflare production branch — confirmed);
   verify the live `/office-v3`.

## Verification

- `npm run typecheck`, `npm run test:unit`, `npx eslint`, `npm run build:vinext`
- `tests/billing-v3-pricing.spec.ts` (Playwright, throwaway local store)
- `supabase/tests/billing-v3-pricing/run.sh` — local Postgres 16 with the
  live history in version order (repository chain + the real 20260902* SQL +
  a 20260912* reconstruction with the exact live signatures): A changes no
  row or existing object; B changes no row and exactly its 7 functions; an
  unexpected live body aborts B; re-runs are refused; behaviour per role; the
  print-cost basis and margin_override are never written.

## Known, pre-existing (not changed here)

- `current_role_name()` is SECURITY INVOKER while the `users_read` policy
  calls it — recursion for signed-in roles on plain Postgres; live runs in
  pilot mode through the service key.
- `tests/billing-flow.spec.ts` 306 / 385 / 664 fail identically on `836813b`.
- `set_project_billing_readiness` locks the project `FOR UPDATE`; the
  projects write policy allows designers only, so BILLING cannot run it under
  RLS (live runs through the service key). Not changed here.
- Sep 2 `set_billing_price` announces `cijd.billing_action = 'price'`, which
  the live guards do not recognise. Compatibility function; not changed.
