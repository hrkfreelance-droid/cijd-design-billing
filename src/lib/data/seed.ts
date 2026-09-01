import type { Database } from "@/lib/types";
import { buildRingerHutHistory } from "./ringer-hut-history";

/**
 * Initial data. Real records only — no sample clients, projects or amounts.
 */

function isoDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function stamp(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString();
}

export function buildSeed(): Database {
  const now = stamp();
  const db: Database = {
    clients: [
      { id: "cl_ringer_hut", name: "Ringer Hut", active: true, createdAt: now },
      { id: "cl_daishin", name: "DAISHIN", active: true, createdAt: now },
    ],
    projects: [
      {
        id: "pj_rh_kids_promotion",
        clientId: "cl_ringer_hut",
        name: "RH Kids Promotion",
        date: isoDate(),
        createdAt: now,
        createdBy: "Hiroki",
        updatedAt: now,
        updatedBy: "Hiroki",
        deletedAt: null,
      },
    ],
    billingItems: [
      {
        id: "bi_rh_kids_correction",
        projectId: "pj_rh_kids_promotion",
        description: "Correction",
        type: "OTHER",
        quantity: 1,
        unitPrice: 15,
        amount: 15,
        customAmount: false,
        productionStatus: "DELIVERED",
        billingStatus: "READY_TO_INVOICE",
        deliveredAt: now,
        deliveredBy: "Hiroki",
        invoiceId: null,
        createdAt: now,
        createdBy: "Hiroki",
        updatedAt: now,
        updatedBy: "Hiroki",
        deletedAt: null,
      },
    ],
    invoices: [],
    invoiceItems: [],
    payments: [],
    telegramSessions: [],
    notifications: [],
    users: [
      { id: "u_hiroki", name: "Hiroki", role: "DESIGNER" },
      { id: "u_billing", name: "Billing Staff", role: "BILLING" },
      { id: "u_accounting", name: "Accounting", role: "ACCOUNTING" },
      { id: "u_admin", name: "Admin", role: "ADMIN" },
    ],
    auditLogs: [],
  };

  const history = buildRingerHutHistory(now);
  db.projects.push(...history.projects);
  db.billingItems.push(...history.billingItems);

  return db;
}
