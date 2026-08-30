import { BillingSnapshot } from "./types";

const CURRENT_DATE = "2026-08-30";

export const initialSnapshot: BillingSnapshot = {
  users: [
    { id: "user-hiroki", name: "Hiroki", role: "Hiroki", active: true },
  ],
  clients: [
    { id: "client-ringer", name: "Ringer Hut", active: true },
    { id: "client-daishin", name: "DAISHIN", active: true },
  ],
  projects: [
    {
      id: "project-rh-kids-promotion",
      clientId: "client-ringer",
      name: "RH Kids Promotion",
      date: CURRENT_DATE,
      createdAt: CURRENT_DATE,
      createdBy: "Hiroki",
      updatedAt: CURRENT_DATE,
      updatedBy: "Hiroki",
    },
  ],
  billingItems: [
    {
      id: "item-rh-kids-correction",
      projectId: "project-rh-kids-promotion",
      description: "Correction",
      type: "Correction",
      quantity: 1,
      unitPrice: 15,
      amount: 15,
      status: "READY_TO_INVOICE",
      createdAt: CURRENT_DATE,
      createdBy: "Hiroki",
      updatedAt: CURRENT_DATE,
      updatedBy: "Hiroki",
    },
  ],
  invoices: [],
  invoiceItems: [],
  payments: [],
  auditLogs: [],
};
