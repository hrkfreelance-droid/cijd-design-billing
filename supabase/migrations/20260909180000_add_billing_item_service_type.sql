-- Billing V2: name the service on the item itself.
--
-- `type` stays exactly as it is — every existing row, constraint and function
-- keeps working. `service_type` is plain text so a new service (VISA, Attend,
-- Translation, …) is a row in the application's service registry rather than
-- another enum migration. Additive and idempotent. Existing rows intentionally
-- remain untouched; the application falls back to `type` until an Admin edits
-- the row through the management path.
alter table public.billing_items
  add column if not exists service_type text;

create index if not exists billing_items_service_type_idx
  on public.billing_items (service_type);
