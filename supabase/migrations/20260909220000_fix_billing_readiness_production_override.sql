-- CIJD Billing V2: an explicit billing readiness override must satisfy the
-- legacy production-completion guard as well as the V2 delivery guard.
-- Keep the existing constraint name so downstream diagnostics remain stable.
alter table public.billing_items
  drop constraint if exists billing_needs_production_completion;

alter table public.billing_items
  add constraint billing_needs_production_completion
  check (
    billing_status in ('NOT_READY', 'NEEDS_REVIEW')
    or production_status in ('DELIVERED', 'COMPLETED')
    or billing_override = true
  ) not valid;
