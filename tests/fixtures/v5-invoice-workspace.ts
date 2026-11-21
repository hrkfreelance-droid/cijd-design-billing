import type { InvoicePayment, Snapshot, TaxInvoiceRecord } from "../../src/lib/types";
import { planV3Import } from "../../src/lib/billing-v5/v3-import";
import { workspaceFixture } from "./v5-workspace-history";

export const example457: TaxInvoiceRecord = {
  id: "example-457-full", invoiceNumber: "CIJDTI2026457", invoiceDate: "2026-11-20",
  clientId: "c1", projectId: "p-ready", ledgerInvoiceId: "", invoiceKind: "FULL",
  issuedAt: "2026-11-20T00:00:00Z", issuedBy: "Example accountant", status: "ISSUED",
  customer: {
    companyNameEn: "Example frozen invoice customer — International Design Company With A Long Name",
    companyNameKm: "ក្រុមហ៊ុន សាកល្បង ឯ.ក", addressEn: "#12, Street 51, Phnom Penh", addressKm: "ផ្ទះលេខ ១២ ផ្លូវ៥១ រាជធានីភ្នំពេញ",
    telephone: "012 345 678", vatin: "K001-123456789",
  },
  project: { name: "Example long subject 印刷デザイン សៀវភៅផ្សព្វផ្សាយ — Brochure production and artwork", note: "Example only" },
  lines: [
    { billingItemId: "example-457-design", projectName: "Brochure artwork 印刷デザイン", description: "Example Logo & layout សាកល្បង", quantity: 2, unit: "pcs", unitPrice: 305, amount: 610 },
    { billingItemId: "example-457-print", projectName: "Brochure production", description: "Example BrochureWithAnIntentionallyLongUnbrokenDescriptionＡＢＣ東南アジアでの印刷", quantity: 500, unit: "pcs", unitPrice: 0.24, amount: 120 },
  ],
  vatApplicable: true, vatPercent: 10, subtotalUsd: 730, discount: { type: "FIXED", value: 20 }, discountUsd: 20,
  taxableUsd: 710, discountPolicy: "DISCOUNT_BEFORE_VAT", vatUsd: 71, totalUsd: 781, totalKhr: 3206005,
  depositUsd: 100, exchangeRate: 4105, exchangeRateSource: "NBC", exchangeRateEffectiveDate: "2026-11-20",
};

export function invoiceWorkspaceFixture(): Snapshot {
  const { collections } = planV3Import(workspaceFixture());
  const final: TaxInvoiceRecord = { ...structuredClone(example457), id: "example-457-final", invoiceNumber: "CIJDTI2026458", invoiceKind: "FINAL", depositUsd: 0,
    contractId: "example-457-contract", contractSnapshot: { id: "example-457-contract", clientId: "c1", lines: example457.lines.map((line) => ({ ...line, billingItemId: line.billingItemId! })),
      subtotalUsd: 1730, vatApplicable: true, vatPercent: 10, vatUsd: 173, totalUsd: 1903 },
    depositReferences: [{ invoiceId: "example-457-deposit", invoiceNumber: "CIJDTI2026450", subtotalUsd: 1000, vatUsd: 100, totalUsd: 1100,
      allocations: [{ billingItemId: "example-457-design", description: "Example earlier artwork", amount: 1000 }] }],
  };
  const large = { ...structuredClone(example457), id: "example-457-large", invoiceNumber: "EXAMPLE-LONG-INVOICE-2026459", totalUsd: 123456789.12, totalKhr: 506790119338,
    subtotalUsd: 112233444.65, vatUsd: 11223344.47, discountUsd: 0, depositUsd: 0 };
  const paid = { ...structuredClone(example457), id: "example-457-paid", invoiceNumber: "CIJDTI2026460" };
  const cancelled = { ...structuredClone(example457), id: "example-457-cancelled", invoiceNumber: "CIJDTI2026461", status: "CANCELLED" as const };
  const payments: InvoicePayment[] = [
    { id: "example-457-deposit-payment", invoiceId: example457.id, kind: "DEPOSIT", amount: 100, paidOn: "2026-11-19", note: "Deposit", createdAt: "2026-11-19T00:00:00Z", createdBy: "Example" },
    { id: "example-457-payment", invoiceId: example457.id, kind: "PAYMENT", amount: 50, paidOn: "2026-11-20", note: "Example transfer — 銀行振込 សាកល្បង", createdAt: "2026-11-20T00:00:00Z", createdBy: "Example" },
    { id: "example-457-voided-payment", invoiceId: example457.id, kind: "PAYMENT", amount: 9, paidOn: "2026-11-20", note: "Example reversed", createdAt: "2026-11-20T00:00:00Z", createdBy: "Example", voidedAt: "2026-11-20T01:00:00Z", voidReason: "Example correction" },
    { id: "example-457-paid-payment", invoiceId: paid.id, kind: "PAYMENT", amount: 781, paidOn: "2026-11-20", createdAt: "2026-11-20T00:00:00Z", createdBy: "Example" },
  ];
  return {
    ...collections, clients: collections.clients.map((client) => client.id === "c1" ? { ...client, name: "Example current customer — Updated Name After Issue 印刷デザイン សាកល្បង" } : client),
    projects: collections.projects.map((project) => project.id === "p-ready" ? { ...project, billingReadiness: "ACCOUNTING" } : project),
    mode: "local", scope: { production: true, billing: true, payment: true, printing: true },
    exchangeRate: { id: "example-457-rate", currencyPair: "USD/KHR", rate: 4105, source: "NBC", effectiveDate: "2026-11-20", fetchedAt: "2026-11-20T10:00:00Z" },
    exchangeRateLastCheckedAt: "2026-11-20T10:00:00Z", taxInvoices: [example457, final, large, paid, cancelled],
    invoicePayments: payments, billingAllocations: [], invoiceRevisions: [], noInvoiceIssues: [],
  };
}
