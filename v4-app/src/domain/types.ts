export type InvoiceStatus = "DRAFT" | "ISSUED" | "CANCELLED";
export type BillingReadiness = "PENDING" | "READY" | "INVOICED";
export type FinalMode = "AUTO" | "UNIT" | "TOTAL";

export interface Customer {
  id: string;
  companyNameEn: string;
  companyNameKm: string;
  contactName: string;
  addressEn: string;
  addressKm: string;
  telephone: string;
  vatin: string;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  customerId: string;
  code: string;
  title: string;
  depositUsd: number;
  createdAt: string;
  updatedAt: string;
}

export interface BillingItem {
  id: string;
  projectId: string;
  serviceType: string;
  description: string;
  quantity: number;
  unitCostUsd: number | null;
  totalCostUsd: number | null;
  markupOverridePercent: number | null;
  recommendedTotalUsd: number | null;
  finalUnitUsd: number;
  finalTotalUsd: number;
  finalMode: FinalMode;
  readiness: BillingReadiness;
  invoicedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerSnapshot {
  companyNameEn: string;
  companyNameKm: string;
  contactName: string;
  addressEn: string;
  addressKm: string;
  telephone: string;
  vatin: string;
}

export interface InvoiceLine {
  id: string;
  invoiceId: string;
  billingItemId: string;
  description: string;
  quantity: number;
  finalUnitUsd: number;
  amountUsd: number;
  sortOrder: number;
}

export interface TaxInvoice {
  id: string;
  projectId: string;
  customerId: string;
  status: InvoiceStatus;
  invoiceNumber: string | null;
  invoiceDate: string;
  customerSnapshot: CustomerSnapshot;
  exchangeRateKhr: number | null;
  exchangeRateSource: string | null;
  exchangeRateEffectiveDate: string | null;
  subtotalUsd: number;
  vatPercent: number;
  vatUsd: number;
  totalUsd: number;
  totalKhr: number | null;
  issuedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string;
  lines: InvoiceLine[];
}

export interface ExchangeRate {
  id: string;
  rateKhrPerUsd: number;
  source: string;
  effectiveDate: string;
  fetchedAt: string;
}

export interface BootstrapData {
  customers: Customer[];
  projects: Project[];
  billingItems: BillingItem[];
  invoices: TaxInvoice[];
  exchangeRate: ExchangeRate | null;
}
