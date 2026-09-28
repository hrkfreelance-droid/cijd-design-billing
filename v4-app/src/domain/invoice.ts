import { roundCents } from "./pricing.ts";

export const VAT_PERCENT = 10;

export function formatInvoiceNumber(year: number, sequence: number): string {
  if (!Number.isInteger(year) || year < 2000 || !Number.isInteger(sequence) || sequence < 1) {
    throw new Error("Invalid invoice number input");
  }
  return `CIJDTI${year}${String(sequence).padStart(3, "0")}`;
}

export function invoiceTotals(lines: readonly { quantity: number; finalUnitUsd: number }[], rateKhrPerUsd: number | null) {
  const subtotalUsd = roundCents(lines.reduce((sum, line) => sum + roundCents(line.quantity * line.finalUnitUsd), 0));
  const vatUsd = roundCents(subtotalUsd * (VAT_PERCENT / 100));
  const totalUsd = roundCents(subtotalUsd + vatUsd);
  return {
    subtotalUsd,
    vatPercent: VAT_PERCENT,
    vatUsd,
    totalUsd,
    totalKhr: rateKhrPerUsd == null ? null : Math.round(totalUsd * rateKhrPerUsd),
  };
}

export function customerSnapshot<T extends {
  companyNameEn: string;
  companyNameKm: string;
  contactName: string;
  addressEn: string;
  addressKm: string;
  telephone: string;
  vatin: string;
}>(customer: T) {
  return {
    companyNameEn: customer.companyNameEn,
    companyNameKm: customer.companyNameKm,
    contactName: customer.contactName,
    addressEn: customer.addressEn,
    addressKm: customer.addressKm,
    telephone: customer.telephone,
    vatin: customer.vatin,
  };
}
