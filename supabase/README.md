# Supabase setup

Nothing here has been run against a live project yet — there are no credentials.
Once a project exists, these steps are all that is needed.

## 1. Create the project

Supabase Free is enough. Note the project URL, the `anon` key and the
`service_role` key from **Project Settings → API**.

## 2. Apply the migrations

In **SQL Editor**, run in order:

1. `migrations/0001_init.sql` — tables, enums, indexes and the constraints that
   protect the money rules
2. `migrations/0002_rls.sql` — row level security and the role helpers
3. `migrations/0003_functions.sql` — the multi-table operations, as atomic
   functions

Or with the Supabase CLI:

```bash
supabase link --project-ref <ref>
supabase db push
```

## 3. Seed the real data

Run `seed.sql`. It contains only confirmed records: Ringer Hut, DAISHIN and the
current `RH Kids Promotion / Correction / $15`. The February–August history is
deliberately absent — import it with `npm run import:history` when the records
are available.

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
