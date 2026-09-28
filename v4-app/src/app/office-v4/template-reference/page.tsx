import { isAuthorized } from "@/server/auth";
import type { TaxInvoice } from "@/domain/types";
import { InvoiceDocument } from "@/ui/invoice-document";
import { PrintActions } from "@/ui/print-actions";

const reference: TaxInvoice = {
  id: "excel-reference-080",
  projectId: "excel-reference",
  customerId: "excel-reference",
  status: "ISSUED",
  invoiceNumber: "CIJDTI2026080",
  invoiceDate: "2026-06-30",
  customerSnapshot: {
    companyNameEn: "Japanese Association for Promotion of Education and Culture Business in Cambodia (JACAM)",
    companyNameKm: "សមាគមជប៉ុនលើកកម្ពស់វិស័យអប់រំ និងវប្បធម៌ជំនួញនៅកម្ពុជា (សជអជក)",
    contactName: "",
    addressEn: "",
    addressKm: "ផ្ទះលេខ២០៥B ផ្លូវលំ ភូមិទឹកថ្លា សង្កាត់ទឹកថ្លា ខណ្ឌសែនសុខ រាជធានីភ្នំពេញ",
    telephone: "",
    vatin: "K009-104018011",
  },
  exchangeRateKhr: 4026,
  exchangeRateSource: "NBC",
  exchangeRateEffectiveDate: "2026-06-30",
  subtotalUsd: 35,
  vatPercent: 10,
  vatUsd: 3.5,
  totalUsd: 38.5,
  totalKhr: 155001,
  issuedAt: "2026-06-30T00:00:00.000Z",
  cancelledAt: null,
  cancellationReason: null,
  createdAt: "2026-06-30T00:00:00.000Z",
  updatedAt: "2026-06-30T00:00:00.000Z",
  lines: [{
    id: "excel-reference-line",
    invoiceId: "excel-reference-080",
    billingItemId: "excel-reference-item",
    description: "Website monthly maintenance for For June 2026",
    quantity: 1,
    finalUnitUsd: 35,
    amountUsd: 35,
    sortOrder: 1,
  }],
};

export const dynamic = "force-dynamic";

export default async function TemplateReferencePage() {
  if (!(await isAuthorized())) return <main className="access-page"><section className="access-card"><h1>Preview access required</h1></section></main>;
  return <main className="print-page"><PrintActions /><InvoiceDocument invoice={reference} /></main>;
}
