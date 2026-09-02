import type {
  BillingItem,
  Client,
  ExchangeRate,
  Invoice,
  InvoiceItem,
  Payment,
  Project,
  User,
} from "@/lib/types";

/** snake_case in Postgres, camelCase in the app. */

type Row = Record<string, unknown>;

const str = (value: unknown) => (value == null ? "" : String(value));
const numeric = (value: unknown) => Number(value ?? 0);

function historicalMonthFromRow(row: Row): string | null {
  const explicit = str(row.historical_month).trim();
  if (/^\d{4}-\d{2}$/.test(explicit)) return explicit;
  const note = str(row.note);
  return note.match(/historical\s+month\s+(\d{4}-\d{2})/i)?.[1] ?? null;
}

export const toClient = (row: Row): Client => ({
  id: str(row.id),
  name: str(row.name),
  active: Boolean(row.active),
  createdAt: str(row.created_at),
});

export const toUser = (row: Row): User => ({
  id: str(row.id),
  name: str(row.name),
  role: row.role as User["role"],
});

export const toProject = (row: Row): Project => ({
  id: str(row.id),
  clientId: str(row.client_id),
  name: str(row.name),
  date: str(row.date),
  note: (row.note as string) ?? undefined,
  createdAt: str(row.created_at),
  createdBy: str(row.created_by),
  updatedAt: str(row.updated_at),
  updatedBy: str(row.updated_by),
  deletedAt: (row.deleted_at as string) ?? null,
});

export const toItem = (row: Row): BillingItem => ({
  id: str(row.id),
  projectId: str(row.project_id),
  description: str(row.description),
  type: row.type as BillingItem["type"],
  quantity: numeric(row.quantity),
  unitPrice: numeric(row.unit_price),
  amount: numeric(row.amount),
  customAmount: Boolean(row.custom_amount),
  productionStatus: row.production_status as BillingItem["productionStatus"],
  billingStatus: row.billing_status as BillingItem["billingStatus"],
  deliveredAt: (row.delivered_at as string) ?? null,
  deliveredBy: (row.delivered_by as string) ?? null,
  invoiceId: (row.invoice_id as string) ?? null,
  historicalMonth: historicalMonthFromRow(row),
  printSize: (row.print_size as string) ?? null,
  priceReviewStatus: (row.price_review_status as BillingItem["priceReviewStatus"]) ?? null,
  suggestedUnitPrice: row.suggested_unit_price == null ? null : numeric(row.suggested_unit_price),
  suggestedAmount: row.suggested_amount == null ? null : numeric(row.suggested_amount),
  priceSource: (row.price_source as string) ?? null,
  priceReason: (row.price_reason as string) ?? null,
  priceConfirmedBy: (row.price_confirmed_by as string) ?? null,
  priceConfirmedAt: (row.price_confirmed_at as string) ?? null,
  printCostUnitPrice: row.print_cost_unit_price == null ? null : numeric(row.print_cost_unit_price),
  printCostAmount: row.print_cost_amount == null ? null : numeric(row.print_cost_amount),
  printCostConfirmedBy: (row.print_cost_confirmed_by as string) ?? null,
  printCostConfirmedAt: (row.print_cost_confirmed_at as string) ?? null,
  billingPriceManual: Boolean(row.billing_price_manual),
  note: (row.note as string) ?? undefined,
  createdAt: str(row.created_at),
  createdBy: str(row.created_by),
  updatedAt: str(row.updated_at),
  updatedBy: str(row.updated_by),
  deletedAt: (row.deleted_at as string) ?? null,
});

export const toInvoice = (row: Row): Invoice => ({
  id: str(row.id),
  clientId: str(row.client_id),
  invoiceNumber: (row.invoice_number as string) ?? null,
  invoiceDate: (row.invoice_date as string) ?? null,
  amount: numeric(row.amount),
  exchangeRate: row.exchange_rate == null ? null : numeric(row.exchange_rate),
  exchangeRateSource: (row.exchange_rate_source as string) ?? null,
  exchangeRateEffectiveDate: (row.exchange_rate_effective_date as string) ?? null,
  exchangeRateFetchedAt: (row.exchange_rate_fetched_at as string) ?? null,
  status: row.status as Invoice["status"],
  paymentDate: (row.payment_date as string) ?? null,
  paymentSlip: (row.payment_slip as string) ?? null,
  receiptStatus: row.receipt_status as Invoice["receiptStatus"],
  createdAt: str(row.created_at),
  createdBy: str(row.created_by),
  updatedAt: str(row.updated_at),
  updatedBy: str(row.updated_by),
});

export const toExchangeRate = (row: Row): ExchangeRate => ({
  id: str(row.id),
  currencyPair: str(row.currency_pair) as ExchangeRate["currencyPair"],
  rate: numeric(row.rate),
  source: str(row.source) as ExchangeRate["source"],
  effectiveDate: str(row.effective_date),
  fetchedAt: str(row.fetched_at),
});

export const toInvoiceItem = (row: Row): InvoiceItem => ({
  invoiceId: str(row.invoice_id),
  billingItemId: str(row.billing_item_id),
});

export const toPayment = (row: Row): Payment => ({
  id: str(row.id),
  invoiceId: str(row.invoice_id),
  amount: numeric(row.amount),
  paidAt: (row.paid_at as string) ?? null,
  slip: (row.slip as string) ?? null,
  createdAt: str(row.created_at),
  createdBy: str(row.created_by),
  voidedAt: (row.voided_at as string) ?? null,
  voidedBy: (row.voided_by as string) ?? null,
});