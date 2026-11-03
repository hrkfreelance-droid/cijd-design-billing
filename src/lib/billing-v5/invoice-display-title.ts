import type { TaxInvoiceKind } from "../types";

/**
 * Title printed on CIJD invoices.
 * Newly issued records explicitly freeze the standard TAX INVOICE title.
 * Records issued before this change have no printedTitle and retain their
 * original Deposit/Final heading when reprinted.
 */
export function invoiceDisplayTitle(invoice: {
  invoiceKind?: TaxInvoiceKind;
  printedTitle?: "TAX_INVOICE";
  draft?: boolean;
}) {
  const standard = invoice.draft === true || invoice.printedTitle === "TAX_INVOICE";
  if (standard || !invoice.invoiceKind || invoice.invoiceKind === "FULL") {
    return { en: "TAX INVOICE", km: "វិក្កយបត្រអាករ", standard: true };
  }
  if (invoice.invoiceKind === "FINAL") {
    return { en: "FINAL TAX INVOICE", km: "វិក្កយបត្រអាករចុងក្រោយ", standard: false };
  }
  return { en: "DEPOSIT TAX INVOICE", km: "វិក្កយបត្រអាករ សម្រាប់ប្រាក់បង់ជាមុន", standard: false };
}
