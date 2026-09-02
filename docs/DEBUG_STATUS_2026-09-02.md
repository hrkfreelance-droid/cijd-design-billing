# CIJD debug status — 2026-09-02

## Fixed in this pass

- PostgreSQL `review_print_price` enum assignment bug that caused Confirm cost to return 400/500-style UI failure.
- `print_cost_unit_price` precision increased to 6 decimals so total-first entry remains mathematically consistent for large quantities.
- Print cost UI now accepts either unit cost or total cost and calculates the other value.
- Designer item editing now accepts either billing unit price or billing total and calculates the other value.
- PRINT manual customer billing also supports unit/total bidirectional entry while remaining separate from internal print cost.
- Project/item edit forms were simplified into calm single-purpose sections to avoid cramped, mixed-control layouts.

## Database smoke test

A rollback-only transaction successfully exercised:

1. `update_print_spec`
2. `review_print_price`
3. `set_billing_price`
4. `set_item_delivery(false)`
5. `set_item_delivery(true)`
6. `create_invoice`

No test data was retained.

## Remaining live verification

- Cloudflare build for the commit containing this pass must succeed.
- After deploy, verify the affected screens in the fixed Review Worker and re-check Supabase API/Postgres logs for new errors.
