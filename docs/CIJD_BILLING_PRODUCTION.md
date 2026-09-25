# CIJD Billing — Production Source of Truth

Permanent reference for how CIJD Billing runs in production. Read this before
any database, pricing or release work. Temporary task notes live in
`docs/HANDOFF_*.md`; this document outlives them.

Last verified: 2026-09-25 (V3 pricing release preparation).

---

## 1. Production at a glance

| | |
|---|---|
| Repository | `hrkfreelance-droid/cijd-design-billing` |
| Cloudflare production branch | `feature/billing-v3` (Workers Builds; confirmed in the dashboard 2026-09-25) |
| Pricing development branch | `feature/billing-v3-pricing` |
| Live URL | https://cijd-design-billing-preview.hrk-freelance.workers.dev/office-v3 |
| Worker | `cijd-design-billing-preview` (`wrangler.jsonc`) |

```
GitHub (feature/billing-v3)
   → Cloudflare Workers Builds  (builds + deploys on push to the production branch)
   → CIJD Billing app            (vinext / Next.js on the Worker)
   → Supabase                    (Postgres, Auth, RLS, SQL functions)
```

Pushing to `feature/billing-v3` **is** a production deploy. Any other branch
at most produces a separate preview version and never changes the live URL.
The GitHub Actions workflows in `.github/workflows/` only verify (the repo
holds no Cloudflare credentials); they are not the deploy path.

### Who owns what

| Concern | Owner | Notes |
|---|---|---|
| App source | GitHub repo | `src/`; V3 screens in `src/components/billing-v3/`, route `src/app/office-v3/` |
| Deployment | Cloudflare Workers Builds | Production branch `feature/billing-v3`; runtime secrets live in the Worker settings (e.g. `SUPABASE_SERVICE_ROLE_KEY` — name only, never commit values) |
| Database | Supabase (live) | **Authoritative.** See §2 |
| Migrations | Supabase `supabase_migrations.schema_migrations` | The repo's `supabase/migrations/` is a **partial** record (§2, §3) |
| Auth | Supabase Auth + `public.users` (role, active) | Signed-in sessions use an RLS-bound client. Access Link and pilot sessions (`CIJD_PILOT_MODE=1` treats an unauthenticated request as ADMIN) use the server-only service key; the app's `GuardedRepository` is then the role boundary |
| Pricing rule | App `src/lib/billing-v2/pricing.ts` **and** SQL `print_markup_recommended_amount` | Must always agree (§4) |
| Invoice / payment state | Supabase SQL functions (`create_invoice`, `confirm_payment`, `void_invoice`, `revert_payment`) and the guard triggers | `billing_status` INVOICED / PAID locks a line |

---

## 2. Database source of truth

**The LIVE Supabase schema is authoritative. The repository's migration
history is behind production.**

During the 2026-09-25 V3 pricing work the live database turned out to contain
migrations that are not in this repository's `supabase/migrations/`:

- four `20260902*` migrations (they exist only on the
  `integrate-production-workspace` branch), and
- three `20260912*` migrations (not in any repository).

In addition, two live function bodies (`update_print_spec` 7-arg and
`review_print_price` 8-arg) differ from every copy in any repository — for
example they authorize with `current_role_name() not in (...)` and have no
service-role branch. A migration that had re-created them from the repository
copies would have silently replaced production behaviour. The body-hash gate
caught it before anything was applied.

**Never assume the repository's migrations describe production.** Before
changing any existing SQL object:

1. Inspect the live migration history (`supabase_migrations.schema_migrations`).
2. Inspect the live schema (columns, constraints, triggers, policies).
3. Inspect the live signatures of every function involved (overloads!).
4. Compare `md5(prosrc)` of every function you will replace with the body you
   wrote the change against.
5. **If any hash differs: STOP.** Do not adapt on the fly; get the live body.

`supabase/tests/billing-v3-pricing/production-state.sql` does steps 1–4 in one
read-only query (§10).

A migration that replaces an existing function must itself enforce step 4
(see `20260925100000` for the pattern: hash preflight + transaction, and for
bodies whose text is not in the repository, derive the new body from the
live definition inside the transaction).

---

## 3. Migration lineage

Applied live, in version order (repository chain + the generations below).

### Repository chain up to 2026-09-01
`0001_init` … `20260901110000_add_nbc_exchange_rates` — identical on every
branch. Core tables, RLS, roles, invoices/payments, printing workflow,
`current_role_name()` (SQL, STABLE, SECURITY INVOKER; returns the active
user's role from `public.users`).

### Sep 2 — print-cost basis (source: branch `integrate-production-workspace`)
- `20260902083529_print_cost_billing_pricing` — `billing_items.print_cost_unit_price`,
  `print_cost_amount`, `print_cost_confirmed_by`, `print_cost_confirmed_at`,
  `billing_price_manual`; `round_print_billing_price(numeric)`;
  `update_print_spec(uuid,text,text,numeric,text,text)` (6-arg);
  `review_print_price(uuid,numeric,numeric,boolean,text,text,text)` (7-arg);
  `set_billing_price(uuid,numeric,text)`; also redefined `ensure_*`,
  `guard_printing_*`, `maintain_*` (later superseded by Sep 9).
- `20260902100000_fix_print_cost_review_enum_and_precision` — enum cast fix for
  the 7-arg review; `print_cost_unit_price` → `numeric(14,6)`.
- `20260902101000_enforce_print_cost_before_delivery` — `set_item_delivery`,
  `set_project_delivery`.
- `20260902121000_default_new_users_inactive` — `users.active` defaults to false.

### Sep 9 — Office/Billing guards and the active print functions (in this repo)
- `20260909120000_add_print_cost_billing_price` — `print_cost` column;
  `ensure_print_price_review`, `maintain_print_price_review`,
  `guard_office_billing_item_update`, `update_print_spec` (7-arg,
  `p_print_cost`), `review_print_price` (8-arg, `p_print_cost`),
  `override_billing_price`. These superseded the Sep 2 trigger/guard bodies
  (proof: live `maintain_print_price_review` ignores
  `cijd.billing_action = 'billing_price'`, which only the Sep 9 body does).
  The live 7-arg / 8-arg app RPC bodies differ from this file (§2).
- `20260909180000` service_type · `20260909190000` null-safe
  `guard_printing_billing_item_update` · `20260909200000`/`210000`/`220000`
  V2 readiness (`set_project_billing_readiness`, `create_invoice`).

### Sep 12 — live-only additions (SQL not in any repository)
- `20260912084617 add_print_margin_override` — `billing_items.margin_override
  numeric(5,4)`, check `NULL or (>= 0 and < 1)`.
- `20260912084732 print_margin_rpc` —
  `update_print_spec_with_margin(uuid,text,text,numeric,numeric,numeric,text,text)`,
  `review_print_price_with_margin(uuid,numeric,numeric,numeric,numeric,boolean,text,text,text)`
  (gross margin: `cost / (1 - margin)`, $5 rounding).
- `20260912092409 print_cost_basis_rpc` —
  `update_print_spec_with_costs(uuid,text,text,numeric,numeric,numeric,numeric,numeric,boolean,text,text)`
  (keeps `print_cost`, `print_cost_amount`, `print_cost_unit_price`,
  `margin_override`, `billing_price_manual` in sync). Real production data uses
  this workflow (as of 2026-09-25: 4 rows with a cost basis, 1 confirmed).

### Sep 25 — V3 pricing (this repo; apply in order)
- `20260925090000_billing_v3_markup_unit_price_deposit` — **additive only**.
  Adds `projects.deposit_amount numeric(12,2)` (NULL = no deposit, `>= 0`) and
  `billing_items.markup_override numeric(6,2)` (percent, NULL = band,
  0–1000); new functions `print_markup_recommended_amount(numeric,numeric)`,
  `override_billing_unit_price(uuid,numeric,numeric,text)`,
  `set_billing_item_markup(uuid,numeric,text)`,
  `set_project_deposit(uuid,numeric,text)`. Plain `CREATE FUNCTION` (fails
  rather than replaces), no row writes, one transaction, preflight refuses to
  run twice.
- `20260925100000_billing_v3_align_recommendation_and_guards` — replaces
  exactly 7 functions after verifying each live body hash (§6): the active
  recommendation paths get the markup rule (formula only; plus the
  `price_review_status` enum cast in the 8-arg review), the guards protect
  `markup_override` and restrict direct BILLING writes, and the two new RPCs
  announce themselves to the guards. The 7-arg `update_print_spec` and 8-arg
  `review_print_price` are derived from their live definitions in-transaction
  (live authorization kept). No row writes, one transaction.

---

## 4. Margin vs markup — two different things

| | `margin_override` | `markup_override` |
|---|---|---|
| Meaning | **Gross margin** (legacy) | **Markup on cost** (V3) |
| Stored as | fraction `numeric(5,4)`, `0 ≤ x < 1` | percent `numeric(6,2)`, `0–1000` (35 = +35%) |
| Formula | `cost / (1 - margin)`, rounded to $5 | `cost × (1 + markup)`, to the cent |
| Status | Compatibility field (Sep 12). Never written by V3. **Do not reinterpret it.** | The V3 per-line manual markup. NULL = default band |

The V3 rule:

```
Recommended = round(Cost Total × (1 + markup), 2)

markup = markup_override / 100          when set
       = 0.50  when Cost Total <= $50
       = 0.40  when $50 < Cost Total <= $100
       = 0.30  when Cost Total > $100

$40 → $60      $80 → $112      $150 → $195      ($80 at a manual 35% → $108)
```

No gross-margin division. No $5 / $10 rounding. Implemented once in the app
(`recommendedFromCost` / `printSellingPriceFromCost` in
`src/lib/billing-v2/pricing.ts`) and once in SQL
(`print_markup_recommended_amount(cost, markup_percent)`); they must agree.

(A third, older rule — `round_print_billing_price`: ×2.0 / 1.7 / 1.5 with
$5/$10 steps — is a Sep 2 compatibility function the app does not call.)

---

## 5. Pricing workflow (V3)

```
Cost → Markup → Recommended → Final → Deposit → Remaining
```

- **Cost** — Qty × Unit Cost = Cost Total (print lines).
- **Markup** — band default, or the line's `markup_override` (persisted;
  "35 % · Manual"; "Use default" clears it to NULL).
- **Recommended** — a reference suggestion. Never billed by itself.
- **Final** — the actual billing value (`billing_items.amount`, and the Final
  Unit Price in `billing_items.unit_price`). One source at a time: AUTO
  (follows Recommended), UNIT (typed unit price), TOTAL (typed total). Only
  "Use recommended" returns a manual line to AUTO.
- **Qty change** — a manual Final Unit Price survives; Final Total = fixed
  Unit Price × Qty (180 × $4.30 = $774 → 181: $778.30 → 200: $860).
- **Deposit** — project-level (`projects.deposit_amount`), payment/balance
  information only. **Never alters any price.**
- **Remaining** — `max(Final Total − Deposit, 0)`; a larger deposit shows
  as Overpaid, never a negative balance.

---

## 6. Function map

Full signatures — several names are overloaded.

### Called by the app (`src/lib/supabase/repository.ts`)

| Function | Role |
|---|---|
| `update_print_spec(uuid,text,text,numeric,numeric,text,text)` | **ACTIVE** — print spec/cost edits (`p_print_cost`). Live auth: `DESIGNER, PRINTING, ADMIN` |
| `review_print_price(uuid,numeric,numeric,numeric,boolean,text,text,text)` | **ACTIVE** — Printing "Set price" (`p_print_cost`). Live auth: `PRINTING, ADMIN` |
| `override_billing_price(uuid,numeric,text)` | ACTIVE — Final total override (fallback path) |
| `override_billing_unit_price(uuid,numeric,numeric,text)` | ACTIVE (Sep 25) — Final total + Final Unit Price |
| `set_billing_item_markup(uuid,numeric,text)` | ACTIVE (Sep 25) — per-line markup; NULL = default |
| `set_project_deposit(uuid,numeric,text)` | ACTIVE (Sep 25) — deposit; locked once billed |
| `set_project_billing_readiness(uuid,text,text)` | ACTIVE — Ready / In progress |
| `set_item_delivery`, `set_project_delivery`, `set_item_completion` | ACTIVE — production state (Sep 2 / earlier bodies; not hash-verified) |
| `create_invoice`, `void_invoice`, `confirm_payment`, `revert_payment` | ACTIVE — invoice/payment lifecycle |

### Triggers on `billing_items` (all live, all BEFORE)

| Trigger | Function | Purpose |
|---|---|---|
| `ensure_print_price_review` | `ensure_print_price_review()` — INSERT | Recommendation for new print lines (markup rule after Sep 25) |
| `guard_office_billing_item_update` | `guard_office_billing_item_update()` — UPDATE | Office roles; announced actions `cijd.billing_action='billing_price'`, `cijd.billing_unit_price`, `cijd.billing_markup` |
| `guard_printing_billing_item_update` | `guard_printing_billing_item_update()` — UPDATE | PRINTING role; actions `cijd.printing_action` = `delivery` / `price` / `spec` |
| `maintain_print_price_review` | `maintain_print_price_review()` — UPDATE | Resets price review on pricing/spec changes, except controlled actions (`price`/`spec`, `billing_price`) |

### Compatibility — present live, not called by the app, **do not change their semantics**

`update_print_spec(uuid,text,text,numeric,text,text)` (Sep 2, 6-arg) ·
`review_print_price(uuid,numeric,numeric,boolean,text,text,text)` (Sep 2, 7-arg) ·
`set_billing_price(uuid,numeric,text)` (Sep 2) ·
`round_print_billing_price(numeric)` (Sep 2) ·
`update_print_spec_with_margin(uuid,text,text,numeric,numeric,numeric,text,text)` (Sep 12) ·
`review_print_price_with_margin(uuid,numeric,numeric,numeric,numeric,boolean,text,text,text)` (Sep 12) ·
`update_print_spec_with_costs(uuid,text,text,numeric,numeric,numeric,numeric,numeric,boolean,text,text)` (Sep 12)

### Hash verification rule

Before replacing a function, compare `md5(pg_proc.prosrc)` with the body the
change was written against; if different, stop. Verified live hashes:

| Function | Live before Sep 25 (verified 2026-09-25) | Expected after `20260925100000` |
|---|---|---|
| `ensure_print_price_review()` | `a92956468b75b1bb2e87652dfe28eaf8` | `0ecd52a8f495e3bfb6c0ddac4811665b` |
| `guard_office_billing_item_update()` | `3e61115d792b25b6ac3fae259a96c4c3` | `b40266c6fdff423a933f8d02cb708e68` |
| `guard_printing_billing_item_update()` | `5f9eea98caf5587be12aaf3e61d95dbb` | `05055b795f6625144d0db7d5aca44544` |
| `update_print_spec(uuid,text,text,numeric,numeric,text,text)` | `bbbf6b4ac9c725e774a54c8e9db2d4a5` | derived from live — record after release |
| `review_print_price(uuid,numeric,numeric,numeric,boolean,text,text,text)` | `7aba03d0e45011bfb47f419714d23e93` | derived from live — record after release |
| `override_billing_unit_price(uuid,numeric,numeric,text)` | after `090000`: `281dc6b30d39d5f3b440d2126d21d4b9` | `10150ac598d412694fdeb06128e7ec08` |
| `set_billing_item_markup(uuid,numeric,text)` | after `090000`: `f91254314ab1fc2d54bf3f4eb8cca941` | `c318d438755e5c503a8c2ff018a88110` |
| `print_markup_recommended_amount(numeric,numeric)` | — (new) | `9971774b60ec4ac30a52c528c7624211` |
| `set_project_deposit(uuid,numeric,text)` | — (new) | `4665cbfc1469d8b4287a228fb9ec880a` |

After the release, run `production-state.sql` and update the two "record
after release" cells.

---

## 7. Production safety rules

- Existing Final prices are historical facts. Never recalculate them.
- Existing invoices and payments are never recalculated.
- No bulk price backfill unless explicitly approved.
- Imported history (`created_by = 'import'`) stays read-only.
- INVOICED / PAID rows stay locked (price, unit price, markup, deposit).
- Prefer additive migrations (new nullable columns, new functions).
- Snapshot data before any DB migration (`live-snapshot.sql`).
- Fingerprint schema and functions before replacing SQL
  (`schema-fingerprint-all.sql`, `production-state.sql`).
- If a live function hash differs from the expected body → **STOP**.
- Apply a DB migration **before** deploying code that depends on it.
- A green Cloudflare build is not a release: verify the actual live page.
- `margin_override` and `markup_override` are never conflated (§4).

---

## 8. Release procedure (canonical)

1. Confirm the Cloudflare production branch (Workers & Pages →
   `cijd-design-billing-preview` → Settings → Build → Branch control).
2. Inspect live Supabase state READ ONLY: `production-state.sql`.
3. Save the data fingerprint: `live-snapshot.sql`.
4. Save the schema/function fingerprint: `schema-fingerprint-all.sql`.
5. Apply the migrations in version order (for V3 pricing:
   `20260925090000`, then `20260925100000`).
6. Re-run steps 2–4.
7. Confirm data is identical and schema differs only as intended.
8. Merge into `feature/billing-v3`.
9. Wait for the Cloudflare build to succeed.
10. Open the actual `/office-v3` and confirm it is the new build.
11. Smoke test: default markup ($40→$60, $80→$112, $150→$195); manual 35%
    persists across reload and prices a later cost ($80→$108); Use default
    ($112); Final Total override with Recommended unchanged and effective
    markup shown; manual unit $4.30 at Qty 180→181→200 ($774 → $778.30 →
    $860) including after reload; deposit partial / equal (Paid in full) /
    over (Remaining $0 + Overpaid); invoiced/paid lines still locked. Use a
    clearly temporary test project, never existing records.

---

## 9. KNOWN / NOT FIXED

- `set_project_billing_readiness` locks the project `FOR UPDATE`, and the
  projects write policy allows designers only — a BILLING session cannot run
  it under RLS. Pilot/live works because the server uses the service-key path.
- Sep 2 `set_billing_price` announces `cijd.billing_action = 'price'`, which the
  guards do not recognise (they know `billing_price`). Compatibility function.
- Overloaded SQL functions and partially recorded history
  (`update_print_spec` ×2 plus `_with_margin` / `_with_costs`;
  `review_print_price` ×2 plus `_with_margin`) make it easy to change the
  wrong overload — always use full signatures.

---

## 10. Tools (all under `supabase/tests/billing-v3-pricing/`)

| File | Use |
|---|---|
| `production-state.sql` | **READ ONLY.** One query: migrations, columns, constraints, triggers, function signatures + body hashes (with expected-hash verdicts), row counts, non-null counts, status counts, data fingerprints. No row contents |
| `live-snapshot.sql` | READ ONLY. Per-table data fingerprints (new nullable columns excluded) |
| `schema-fingerprint.sql` / `schema-fingerprint-all.sql` | READ ONLY. Hash of every public function, trigger, constraint, policy and column |
| `live-schema-export.sql` | READ ONLY. Exports live function definitions and the recorded Sep 12 SQL |
| `run.sh` | Local Postgres 16 harness replaying the live history (repo chain + real Sep 2 SQL + Sep 12 reconstruction + live app-RPC reconstruction) and testing both Sep 25 migrations. Never connects to Supabase |
