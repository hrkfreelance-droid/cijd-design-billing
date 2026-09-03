import { expect, test } from "@playwright/test";

import { calculateBillingLine } from "@/lib/billing-pricing";
import { createInvoicePdf } from "@/lib/invoice-pdf";
import type { BillingItem, Invoice } from "@/lib/types";

test("billing line discounts support percent and fixed amount", () => {
  expect(calculateBillingLine(2, 50, "PERCENT", 10)).toEqual({
    baseAmount: 100,
    discountAmount: 10,
    subtotal: 90,
  });
  expect(calculateBillingLine(3, 20, "AMOUNT", 15)).toEqual({
    baseAmount: 60,
    discountAmount: 15,
    subtotal: 45,
  });
  expect(calculateBillingLine(1, 100, "PERCENT", 100).subtotal).toBe(0);
});

test("customer PDF includes document settings but never staff note", () => {
  const invoice = {
    id: "invoice-1",
    clientId: "client-1",
    invoiceNumber: "CIJD-TEST",
    invoiceDate: "2026-09-03",
    amount: 90,
    poNumber: "PO-123",
    showParentCompany: true,
    parentCompanyName: "Parent Holdings",
    pltFormat: "DISTRIBUTOR",
    stateChargeVat: true,
    noVat: false,
    customerNote: "Customer-visible note",
    staffNote: "INTERNAL-SECRET-NOTE",
    status: "ISSUED",
    receiptStatus: "PENDING",
    createdAt: "2026-09-03T00:00:00Z",
    createdBy: "Billing",
    updatedAt: "2026-09-03T00:00:00Z",
    updatedBy: "Billing",
  } as Invoice;
  const item = {
    id: "item-1",
    projectId: "project-1",
    description: "Display Name",
    originalName: "Original Name",
    type: "DESIGN",
    quantity: 2,
    unitPrice: 50,
    discountType: "PERCENT",
    discountValue: 10,
    amount: 90,
    customAmount: true,
    productionStatus: "COMPLETED",
    billingStatus: "INVOICED",
    createdAt: "2026-09-03T00:00:00Z",
    createdBy: "Billing",
    updatedAt: "2026-09-03T00:00:00Z",
    updatedBy: "Billing",
  } as BillingItem;

  const pdfText = new TextDecoder().decode(createInvoicePdf({
    invoice,
    clientName: "Client Co.",
    items: [item],
    projectNames: new Map([["project-1", "Project A"]]),
    locale: "en",
  }));

  expect(pdfText).toContain("PO-123");
  expect(pdfText).toContain("Parent Holdings");
  expect(pdfText).toContain("Customer-visible note");
  expect(pdfText).toContain("Original Name");
  expect(pdfText).not.toContain("INTERNAL-SECRET-NOTE");
});
