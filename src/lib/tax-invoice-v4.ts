export const TAX_VAT_RATE = 0.1;
export type TaxInvoiceStatus = "DRAFT" | "ISSUED" | "CANCELLED";
export type TaxInvoiceLineSource = "BILLING_ITEM" | "MANUAL";

export interface TaxInvoiceLineDraft {
  id: string;
  sourceType: TaxInvoiceLineSource;
  billingItemId?: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  sortOrder: number;
}

export interface TaxInvoiceTotals {
  subtotal: string;
  vatAmount: string;
  usdTotal: string;
  khrTotal: string | null;
}

/** Decimal-safe accounting arithmetic using integer cents. */
export function cents(value: string | number): bigint {
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,})?$/.test(text)) throw new Error(`Invalid money value: ${value}`);
  const [whole, fraction = ""] = text.split(".");
  const padded = (fraction + "00").slice(0, 3);
  let result = BigInt(whole) * BigInt(100) + BigInt(padded.slice(0, 2));
  if (padded[2] >= "5") result += BigInt(1);
  return result;
}

function formatCents(value: bigint): string {
  return `${value / BigInt(100)}.${String(value % BigInt(100)).padStart(2, "0")}`;
}

export function lineAmount(line: Pick<TaxInvoiceLineDraft, "quantity" | "unitPrice">): string {
  const quantity = Number(line.quantity);
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error("Invalid quantity");
  const raw = quantity * Number(line.unitPrice);
  if (!Number.isFinite(raw) || raw < 0) throw new Error("Invalid unit price");
  return formatCents(cents(raw.toFixed(6)));
}

export function calculateTaxInvoice(lines: TaxInvoiceLineDraft[], exchangeRate?: string | number | null): TaxInvoiceTotals {
  const subtotal = lines.reduce((sum, line) => sum + cents(lineAmount(line)), BigInt(0));
  const vat = (subtotal * BigInt(10) + BigInt(50)) / BigInt(100);
  const usd = subtotal + vat;
  const khr = exchangeRate == null ? null : String(Math.round(Number(formatCents(usd)) * Number(exchangeRate)));
  return { subtotal: formatCents(subtotal), vatAmount: formatCents(vat), usdTotal: formatCents(usd), khrTotal: khr };
}

export function allocateInvoiceNumber(year: number, used: Iterable<string>): string {
  const prefix = `CIJDTI${year}`;
  let max = 0;
  for (const value of used) {
    const match = value.match(new RegExp(`^${prefix}(\\d{3})$`));
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

export function assertIssueable(input: { customerName?: string; invoiceDate?: string; lines: TaxInvoiceLineDraft[]; exchangeRate?: string | number | null }): void {
  if (!input.customerName?.trim()) throw new Error("Customer is required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.invoiceDate ?? "")) throw new Error("Invoice date is required");
  if (!input.lines.length) throw new Error("At least one line item is required");
  if (input.exchangeRate != null && (!(Number(input.exchangeRate) > 0) || !Number.isFinite(Number(input.exchangeRate)))) throw new Error("Exchange rate is invalid");
  for (const line of input.lines) {
    if (!line.description.trim()) throw new Error("Line description is required");
    lineAmount(line);
  }
}
