-- CIJD invoice document options + customer-facing line discounts.
-- Additive only: existing invoices/items remain valid with neutral defaults.

alter table public.billing_items
  add column if not exists original_name text,
  add column if not exists discount_type text not null default 'NONE',
  add column if not exists discount_value numeric(12, 2) not null default 0;

alter table public.billing_items
  drop constraint if exists billing_items_discount_type_check,
  add constraint billing_items_discount_type_check
    check (discount_type in ('NONE', 'PERCENT', 'AMOUNT')),
  drop constraint if exists billing_items_discount_value_check,
  add constraint billing_items_discount_value_check
    check (
      discount_value >= 0
      and (discount_type <> 'PERCENT' or discount_value <= 100)
    );

alter table public.invoices
  add column if not exists po_number text,
  add column if not exists show_parent_company boolean not null default false,
  add column if not exists parent_company_name text,
  add column if not exists plt_format text not null default 'NORMAL',
  add column if not exists state_charge_vat boolean not null default false,
  add column if not exists no_vat boolean not null default false,
  add column if not exists customer_note text,
  add column if not exists staff_note text;

alter table public.invoices
  drop constraint if exists invoices_plt_format_check,
  add constraint invoices_plt_format_check
    check (plt_format in ('NORMAL', 'IMPORT_PRODUCT', 'DISTRIBUTOR')),
  drop constraint if exists invoices_vat_flags_check,
  add constraint invoices_vat_flags_check
    check (not (state_charge_vat and no_vat));

create or replace function public.set_billing_line_pricing(
  p_item_id uuid,
  p_original_name text,
  p_unit_price numeric,
  p_quantity numeric,
  p_discount_type text,
  p_discount_value numeric,
  p_actor text
) returns public.billing_items
language plpgsql set search_path = public as $$
declare
  item public.billing_items;
  actor_name text := coalesce((select name from public.users where id = auth.uid()), nullif(btrim(p_actor), ''), 'Unknown');
  next_type text := upper(coalesce(nullif(btrim(p_discount_type), ''), 'NONE'));
  next_value numeric := coalesce(p_discount_value, 0);
  base_amount numeric;
  discount_amount numeric;
  next_amount numeric;
  quantity_changed boolean;
  next_print_cost numeric;
begin
  if auth.role() <> 'service_role'
     and coalesce(public.current_role_name()::text,'') not in ('BILLING','ADMIN') then
    raise exception 'FORBIDDEN';
  end if;

  select * into item from public.billing_items where id = p_item_id and deleted_at is null;
  if not found then raise exception 'NOT_FOUND' using detail = 'Billing item was not found.'; end if;
  if lower(btrim(item.created_by)) = 'import' then raise exception 'HISTORY_READ_ONLY'; end if;
  if item.billing_status in ('INVOICED','PAID') then raise exception 'ITEM_LOCKED'; end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'INVALID' using detail = 'Quantity must be greater than zero.';
  end if;
  if p_unit_price is null or p_unit_price < 0 then
    raise exception 'INVALID' using detail = 'Unit price must be zero or more.';
  end if;
  if next_type not in ('NONE','PERCENT','AMOUNT') then
    raise exception 'INVALID' using detail = 'Discount type is invalid.';
  end if;
  if next_value < 0 then raise exception 'INVALID' using detail = 'Discount cannot be negative.'; end if;
  if next_type = 'PERCENT' and next_value > 100 then
    raise exception 'INVALID' using detail = 'Discount percentage must be between 0 and 100.';
  end if;

  base_amount := round(p_quantity * p_unit_price, 2);
  discount_amount := case
    when next_type = 'PERCENT' then round(base_amount * next_value / 100, 2)
    when next_type = 'AMOUNT' then round(next_value, 2)
    else 0
  end;
  if discount_amount > base_amount then
    raise exception 'INVALID' using detail = 'Discount amount cannot exceed the line total.';
  end if;
  next_amount := round(base_amount - discount_amount, 2);
  quantity_changed := p_quantity is distinct from item.quantity;
  next_print_cost := case
    when item.print_cost_unit_price is not null then round(p_quantity * item.print_cost_unit_price, 2)
    else item.print_cost_amount
  end;

  perform set_config('cijd.billing_action', 'line_pricing', true);
  update public.billing_items set
    original_name = nullif(btrim(coalesce(p_original_name, original_name, description)), ''),
    unit_price = round(p_unit_price, 2),
    quantity = p_quantity,
    discount_type = next_type,
    discount_value = round(next_value, 2),
    amount = next_amount,
    custom_amount = next_type <> 'NONE',
    billing_price_manual = true,
    print_cost_amount = case when type = 'PRINT' and quantity_changed then next_print_cost else print_cost_amount end,
    print_cost_confirmed_by = case when type = 'PRINT' and quantity_changed then null else print_cost_confirmed_by end,
    print_cost_confirmed_at = case when type = 'PRINT' and quantity_changed then null else print_cost_confirmed_at end,
    price_review_status = case when type = 'PRINT' and quantity_changed then 'REVIEW_REQUIRED'::public.price_review_status else price_review_status end,
    price_confirmed_by = case when type = 'PRINT' and quantity_changed then null else price_confirmed_by end,
    price_confirmed_at = case when type = 'PRINT' and quantity_changed then null else price_confirmed_at end,
    billing_status = case
      when type = 'PRINT' and quantity_changed and production_status in ('DELIVERED','COMPLETED')
        then 'NEEDS_REVIEW'::public.billing_status
      else billing_status
    end,
    updated_at = now(),
    updated_by = actor_name
  where id = p_item_id returning * into item;

  insert into public.audit_logs (actor, action, entity, entity_id, detail)
  values (
    actor_name,
    'billing.line_pricing.update',
    'billing_item',
    item.id,
    format('qty=%s unit=%s discount=%s:%s subtotal=%s', item.quantity, item.unit_price, item.discount_type, item.discount_value, item.amount)
  );
  return item;
end;
$$;

-- Keep the existing create_invoice(...) contract intact for older callers.
-- New UI uses this extended RPC so document metadata is saved atomically with
-- the invoice and the same NBC-rate + billing gates remain enforced.
create or replace function public.create_invoice_with_options(
  p_client_id uuid,
  p_invoice_number text,
  p_invoice_date date,
  p_item_ids uuid[],
  p_po_number text,
  p_show_parent_company boolean,
  p_parent_company_name text,
  p_plt_format text,
  p_state_charge_vat boolean,
  p_no_vat boolean,
  p_customer_note text,
  p_staff_note text,
  p_actor text
) returns public.invoices
language plpgsql security invoker set search_path = public as $$
declare
  invoice public.invoices;
  item public.billing_items;
  rate_row public.exchange_rates;
  total numeric(12, 2) := 0;
  requested_count integer;
  found_count integer;
  invoice_day date := (now() at time zone 'Asia/Phnom_Penh')::date;
  next_plt text := upper(coalesce(nullif(btrim(p_plt_format), ''), 'NORMAL'));
begin
  if p_invoice_number is null or btrim(p_invoice_number) = '' then
    raise exception 'INVALID' using detail = 'Invoice number is required.';
  end if;
  if p_item_ids is null or array_length(p_item_ids, 1) is null then
    raise exception 'INVALID' using detail = 'Select at least one item.';
  end if;
  if next_plt not in ('NORMAL','IMPORT_PRODUCT','DISTRIBUTOR') then
    raise exception 'INVALID' using detail = 'PLT Format is invalid.';
  end if;
  if coalesce(p_state_charge_vat,false) and coalesce(p_no_vat,false) then
    raise exception 'INVALID' using detail = 'State Charge VAT and No VAT cannot both be enabled.';
  end if;
  if coalesce(p_show_parent_company,false)
     and nullif(btrim(coalesce(p_parent_company_name,'')), '') is null then
    raise exception 'INVALID' using detail = 'Parent company name is required when it is shown in the PDF.';
  end if;

  select count(*) into requested_count from unnest(p_item_ids) as requested(id);
  select count(*) into found_count
    from public.billing_items
    where id = any (p_item_ids) and deleted_at is null;
  if found_count <> requested_count then
    raise exception 'NOT_FOUND' using detail = 'One or more billing items were not found.';
  end if;
  if exists (
    select 1 from public.invoices
    where status <> 'VOID' and lower(invoice_number) = lower(btrim(p_invoice_number))
  ) then
    raise exception 'DUPLICATE_INVOICE_NUMBER' using detail = 'That invoice number is already in use.';
  end if;

  select * into rate_row
    from public.exchange_rates
    where currency_pair = 'USD/KHR'
      and source = 'NBC'
      and effective_date <= invoice_day
    order by effective_date desc
    limit 1;
  if not found then
    raise exception 'EXCHANGE_RATE_UNAVAILABLE'
      using detail = 'An official NBC USD/KHR rate is required before issuing an invoice.';
  end if;

  for item in
    select * from public.billing_items where id = any (p_item_ids) and deleted_at is null
  loop
    if not exists (
      select 1 from public.projects where id = item.project_id and client_id = p_client_id
    ) then
      raise exception 'INVALID' using detail = 'All items must belong to the same client.';
    end if;
    if item.billing_status in ('INVOICED', 'PAID') then raise exception 'ALREADY_INVOICED'; end if;
    if item.production_status not in ('DELIVERED', 'COMPLETED') then
      raise exception 'NOT_DELIVERED' using detail = format('"%s" has not completed production yet.', item.description);
    end if;
    if item.type = 'PRINT'
       and lower(btrim(item.created_by)) <> 'import'
       and coalesce(to_jsonb(item)->>'price_review_status', 'REVIEW_REQUIRED') <> 'CONFIRMED' then
      raise exception 'PRICE_REVIEW_REQUIRED' using detail = format('"%s" needs a confirmed print price first.', item.description);
    end if;
    if item.billing_status <> 'READY_TO_INVOICE' then
      raise exception 'NOT_READY' using detail = format('"%s" is not ready to invoice yet.', item.description);
    end if;
    total := total + item.amount;
  end loop;

  insert into public.invoices (
    client_id, invoice_number, invoice_date, amount, exchange_rate,
    exchange_rate_source, exchange_rate_effective_date, exchange_rate_fetched_at,
    po_number, show_parent_company, parent_company_name, plt_format,
    state_charge_vat, no_vat, customer_note, staff_note,
    status, receipt_status, created_by, updated_by
  ) values (
    p_client_id, btrim(p_invoice_number), invoice_day, total, rate_row.rate,
    rate_row.source, rate_row.effective_date, rate_row.fetched_at,
    nullif(btrim(coalesce(p_po_number,'')), ''), coalesce(p_show_parent_company,false),
    case when coalesce(p_show_parent_company,false) then nullif(btrim(coalesce(p_parent_company_name,'')), '') else null end,
    next_plt, coalesce(p_state_charge_vat,false), coalesce(p_no_vat,false),
    nullif(btrim(coalesce(p_customer_note,'')), ''), nullif(btrim(coalesce(p_staff_note,'')), ''),
    'ISSUED', 'PENDING', p_actor, p_actor
  ) returning * into invoice;

  insert into public.invoice_items (invoice_id, billing_item_id)
    select invoice.id, unnest(p_item_ids);
  update public.billing_items
    set billing_status = 'INVOICED', invoice_id = invoice.id,
        updated_at = now(), updated_by = p_actor
    where id = any (p_item_ids);
  insert into public.audit_logs (actor, action, entity, entity_id, detail)
    values (p_actor, 'invoice.create', 'invoice', invoice.id, invoice.invoice_number);
  return invoice;
end;
$$;

revoke all on function public.set_billing_line_pricing(uuid, text, numeric, numeric, text, numeric, text) from public, anon;
grant execute on function public.set_billing_line_pricing(uuid, text, numeric, numeric, text, numeric, text)
  to authenticated, service_role;

revoke all on function public.create_invoice_with_options(uuid, text, date, uuid[], text, boolean, text, text, boolean, boolean, text, text, text) from public, anon;
grant execute on function public.create_invoice_with_options(uuid, text, date, uuid[], text, boolean, text, text, boolean, boolean, text, text, text)
  to authenticated, service_role;
