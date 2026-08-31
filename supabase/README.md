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
5. `migrations/20260831011623_harden_role_functions.sql` — fixed function
   search paths, invoker-side role lookup, and Auth trigger execution rights
6. `migrations/20260831012607_revoke_anon_access.sql` — removes any remaining
   anonymous Data API access
7. `migrations/20260831015410_enforce_active_users_and_audit.sql` — inactive
   profiles are denied by role lookup and user/project/receipt changes are
   audited
8. `migrations/20260831020942_restrict_office_billing_item_updates.sql` —
   Billing can change only the review/ready billing status of an unlocked
   completed-production item; Accounting cannot update billing items directly
9. `migrations/20260831090000_add_completed_production_status.sql` — adds the
   `COMPLETED` creative-production state, extends RLS and the invoice gate, and
   keeps PRINT delivery separate from creative completion
10. `migrations/20260831110000_add_printing_workflow.sql` — adds the `PRINTING`
   role, print-only RLS, explicit price review fields, audit-backed price
   review operations, and the confirmed-price invoice gate

Or with the Supabase CLI:

```bash
npx supabase migration list --linked
npx supabase db push --linked --skip-vault --dry-run
npx supabase db push --linked --skip-vault
```

## 3. Seed the real data

Run `seed.sql` only after the migrations. It contains only confirmed records:
Ringer Hut, DAISHIN and the current `RH Kids Promotion / Correction / $15`.
The current item must remain `DELIVERED / READY_TO_INVOICE` with no invoice or
payment. The February–August history is imported separately:

```bash
npx supabase db query --linked --file supabase/seed.sql
npm run test:import
npm run import:history -- history.csv "Ringer Hut"
npx supabase db query --linked --file supabase/import-history.sql
```

The historical SQL must be applied after the seed. It must not merge with the
current live item. Expected historical totals are 46 projects, 71 billing
items, 28 invoices, 28 invoice links, and 0 payments.

## 4. Create the people

Do this only after the real work email addresses are confirmed. The trusted
CLI helper creates a confirmed Supabase Auth user and its `public.users`
profile without putting a password in shell history:

```bash
SUPABASE_SERVICE_ROLE_KEY='(set only in the local shell)' \
  npm run supabase:user -- --email person@example.com --role DESIGNER --name 'Hiroki'
```

The helper accepts `DESIGNER`, `BILLING`, `ACCOUNTING`, `PRINTING`, or `ADMIN`; it asks for
the password without echoing it. Never run it in the browser or commit the
service-role key. The Dashboard path is also valid: **Authentication → Users
→ Add user**, then set the matching `public.users` profile:

```sql
update users set name = 'Hiroki',        role = 'DESIGNER'   where id = '<auth uid>';
update users set name = 'Billing Staff', role = 'BILLING'    where id = '<auth uid>';
update users set name = 'Accounting',    role = 'ACCOUNTING' where id = '<auth uid>';
update users set name = 'Admin',         role = 'ADMIN'      where id = '<auth uid>';
update users set name = 'Printing',      role = 'PRINTING'   where id = '<auth uid>';
```

A new Auth sign-up gets a `users` row automatically with the `DESIGNER` role;
nobody can raise their own role, because the policy on `users` only lets an
`ADMIN` write to it. For a new employee, create the Auth user, confirm the
email policy, then assign the intended role. For retirement, set
`active = false` first and revoke the Auth session in the Dashboard if needed;
do not delete the business profile.

Password reset is performed from the Sign in screen. Configure Supabase Auth
email delivery and the application URL/redirect allow-list before relying on
the email. Passwords are never stored in `public.users`, SQL, CSV, audit logs,
or Git history.

To disable or change a profile as an administrator:

```sql
update public.users set active = false where id = '<auth uid>';
update public.users set active = true  where id = '<auth uid>';
update public.users set role = 'BILLING' where id = '<auth uid>';
update public.users set role = 'PRINTING' where id = '<auth uid>';
```

The application checks `active` on every session lookup and the RLS role
helper also ignores inactive profiles.

## 5. Point the app at it

Put `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in
`.env.local` (see `.env.example`) and restart. The app switches to Supabase on
its own — sign-in becomes email and password. Add
`SUPABASE_SERVICE_ROLE_KEY` only when enabling the server-side Telegram
endpoint; never expose that key to the browser.

For a printing operator, use the same Auth/profile flow with `role =
'PRINTING'`. The Printing workspace exposes only PRINT items; imported PRINT
rows remain read-only history. A current print item must have a human-confirmed
price before it can become invoice-ready.

日々の請求・入金・障害対応、NEEDS_REVIEWの扱い、バックアップ・復旧、
Telegram停止時の手順は [`docs/OPERATIONS.md`](../docs/OPERATIONS.md) を参照してください。

## What the database enforces on its own

- `billing_needs_production_completion` — an item cannot be `READY_TO_INVOICE`,
  `INVOICED` or `PAID` unless it is `DELIVERED` or `COMPLETED`
- `invoice_items.billing_item_id` is unique — one item can never be on two
  invoices
- `invoices_number_unique` — no two live invoices share a number
- `payments_one_live_per_invoice` — one live payment per invoice
- Historical imports may keep a confirmed invoice/payment with a null invoice
  number, invoice date, or payment date; live invoice and payment actions still
  require their normal input values.
- RLS — billing and accounting cannot read undelivered work, and the design side
  cannot read invoices or payments, whatever the request looks like
