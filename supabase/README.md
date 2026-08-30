# Supabase setup

This repository is prepared for the existing Supabase project
`dldfhhcechzhkbvlnzld` in `ap-northeast-2`. Do not create another project.
Keep all credentials outside Git and never paste key values into terminal
reports, README files, or commits.

## 1. Authenticate and link the existing project

Install or run the Supabase CLI, then authenticate with an account that has
access to the project. The CLI is not included as an application dependency.

```bash
npx supabase login
npx supabase link --project-ref dldfhhcechzhkbvlnzld
```

The link step may ask for the database password. Store it only in the CLI
prompt or approved local secret storage.

## 2. Apply the migrations

In **SQL Editor**, run in order:

1. `migrations/0001_init.sql` — tables, enums, indexes and the constraints that
   protect the money rules
2. `migrations/0002_rls.sql` — row level security and the role helpers
3. `migrations/0003_functions.sql` — the multi-table operations, as atomic
   functions
4. `migrations/20260830165135_api_grants.sql` — explicit Data API grants for
   authenticated users and the server-side service role; anonymous access is
   not granted

Or with the Supabase CLI:

```bash
npx supabase migration list --project-ref dldfhhcechzhkbvlnzld
npx supabase db push --project-ref dldfhhcechzhkbvlnzld --dry-run
npx supabase db push --project-ref dldfhhcechzhkbvlnzld
```

## 3. Seed the real data

Run `seed.sql` only after the migrations. It contains only confirmed records:
Ringer Hut, DAISHIN and the current `RH Kids Promotion / Correction / $15`.
The current item must remain `DELIVERED / READY_TO_INVOICE` with no invoice or
payment. The February–August history is imported separately:

```bash
npx supabase db query --project-ref dldfhhcechzhkbvlnzld --file supabase/seed.sql
npm run test:import
npm run import:history -- history.csv "Ringer Hut"
npx supabase db query --project-ref dldfhhcechzhkbvlnzld --file supabase/import-history.sql
```

The historical SQL must be applied after the seed. It must not merge with the
current live item. Expected historical totals are 46 projects, 71 billing
items, 28 invoices, 28 invoice links, and 0 payments.

## 4. Create the people

**Authentication → Users → Add user** for each person, then set their role:

```sql
update users set name = 'Hiroki',        role = 'DESIGNER'   where id = '<auth uid>';
update users set name = 'Billing Staff', role = 'BILLING'    where id = '<auth uid>';
update users set name = 'Accounting',    role = 'ACCOUNTING' where id = '<auth uid>';
update users set name = 'Admin',         role = 'ADMIN'      where id = '<auth uid>';
```

A new sign-up gets a `users` row automatically with the `DESIGNER` role; nobody
can raise their own role, because the policy on `users` only lets an `ADMIN`
write to it.

## 5. Point the app at it

Put the three keys in `.env.local` (see `.env.example`) and restart. The app
switches to Supabase on its own — sign-in becomes email and password.

## What the database enforces on its own

- `billing_needs_delivery` — an item cannot be `READY_TO_INVOICE`, `INVOICED` or
  `PAID` unless it is `DELIVERED`
- `invoice_items.billing_item_id` is unique — one item can never be on two
  invoices
- `invoices_number_unique` — no two live invoices share a number
- `payments_one_live_per_invoice` — one live payment per invoice
- Historical imports may keep a confirmed invoice/payment with a null invoice
  number, invoice date, or payment date; live invoice and payment actions still
  require their normal input values.
- RLS — billing and accounting cannot read undelivered work, and the design side
  cannot read invoices or payments, whatever the request looks like
