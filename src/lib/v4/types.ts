import type { TaxInvoiceLineDraft, TaxInvoiceStatus } from "@/lib/tax-invoice-v4";

export interface V4Customer { id: string; name: string; khmerName: string | null; address: string | null; phone: string | null; vatin: string | null; }
export interface V4Invoice {
  id: string; invoiceNumber: string | null; status: TaxInvoiceStatus; invoiceDate: string; customerId: string | null;
  customerName: string; customerKhmerName: string | null; customerAddress: string | null; customerPhone: string | null; customerVatin: string | null;
  lines: TaxInvoiceLineDraft[]; subtotal: string; vatRate: string; vatAmount: string; usdTotal: string; exchangeRate: string | null; exchangeRateSource: string | null; exchangeRateDate: string | null; exchangeRateManualOverride: boolean; khrTotal: string | null; issuedAt: string | null; cancelledAt: string | null; createdAt: string; updatedAt: string;
}
