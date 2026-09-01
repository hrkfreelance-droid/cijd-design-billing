import type { BillingItem, Database, ItemType, Project } from "@/lib/types";

export const RINGER_HUT_HISTORY_SOURCE = "ringer_hut_history_2026_02_08.csv";
export const RINGER_HUT_HISTORY_SHA256 = "499227027488a33349b8b1327f42acc1dc692f2748c7817899bbfc16f278f53b";

export interface RingerHutHistoryRow {
  row: number;
  month: string;
  project: string;
  billingItem: string;
  amountUsd: string;
  invoiceFact: string;
  paymentFact: string;
  status: "NEEDS_REVIEW" | "INVOICED";
  note: string;
}

/** Exact 71-row source values; empty CSV fields remain empty strings. */
export const RINGER_HUT_HISTORY: readonly RingerHutHistoryRow[] = [
  { row: 1, month: "2026-02", project: "Ringer Hut Storefront Sign", billingItem: "", amountUsd: "", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Project exists; amount/invoice/payment unconfirmed" },
  { row: 2, month: "2026-02", project: "Ringer Hut A4", billingItem: "Design", amountUsd: "75", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Amount known; invoice/payment unconfirmed" },
  { row: 3, month: "2026-02", project: "Ringer Hut iStand", billingItem: "Resize", amountUsd: "25", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Approx. historical amount; treat as unconfirmed" },
  { row: 4, month: "2026-02", project: "Ringer Hut A5 Print", billingItem: "Print", amountUsd: "", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Unit price $0.35/pc known; quantity/payment unconfirmed" },
  { row: 5, month: "2026-03", project: "AEON_SS Sign", billingItem: "", amountUsd: "", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Project known; billing/payment status unconfirmed" },
  { row: 6, month: "2026-03", project: "Hot Pot A4", billingItem: "Design", amountUsd: "75", invoiceFact: "YES", paymentFact: "", status: "INVOICED", note: "Major early batch confirmed invoice-complete; payment not separately confirmed" },
  { row: 7, month: "2026-03", project: "Hot Pot A4 20%", billingItem: "Design", amountUsd: "75", invoiceFact: "YES", paymentFact: "", status: "INVOICED", note: "Major early batch confirmed invoice-complete; payment not separately confirmed" },
  { row: 8, month: "2026-03", project: "Chinese New Year A4", billingItem: "Design", amountUsd: "75", invoiceFact: "YES", paymentFact: "", status: "INVOICED", note: "Major early batch confirmed invoice-complete; payment not separately confirmed" },
  { row: 9, month: "2026-03", project: "Chinese New Year iStand", billingItem: "Resize", amountUsd: "25", invoiceFact: "YES", paymentFact: "", status: "INVOICED", note: "Major early batch confirmed invoice-complete; payment not separately confirmed" },
  { row: 10, month: "2026-03", project: "Certificate of Completion", billingItem: "", amountUsd: "", invoiceFact: "YES", paymentFact: "", status: "INVOICED", note: "Major early batch confirmed invoice-complete; amount/payment unconfirmed" },
  { row: 11, month: "2026-03", project: "$3 Champon A4", billingItem: "Design", amountUsd: "75", invoiceFact: "YES", paymentFact: "", status: "INVOICED", note: "Major early batch confirmed invoice-complete; payment not separately confirmed" },
  { row: 12, month: "2026-03", project: "$3 Champon iStand", billingItem: "Resize", amountUsd: "25", invoiceFact: "YES", paymentFact: "", status: "INVOICED", note: "Major early batch confirmed invoice-complete; payment not separately confirmed" },
  { row: 13, month: "2026-03", project: "3 Kinds Soup Options", billingItem: "", amountUsd: "", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Later/add-on work; invoice/payment unconfirmed" },
  { row: 14, month: "2026-03", project: "Selectable 3 Types", billingItem: "Print", amountUsd: "", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "60 prints known; amount/invoice/payment unconfirmed" },
  { row: 15, month: "2026-03", project: "BKK Sign", billingItem: "", amountUsd: "", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Status unconfirmed" },
  { row: 16, month: "2026-03", project: "Payment Stand A5", billingItem: "", amountUsd: "", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Status unconfirmed" },
  { row: 17, month: "2026-03", project: "SS Monitor", billingItem: "Monitor Resize", amountUsd: "", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Approx. $20–25 historically; not safe to lock amount" },
  { row: 18, month: "2026-04", project: "Teishoku", billingItem: "iStand", amountUsd: "25", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Amount approximate; invoice/payment unconfirmed" },
  { row: 19, month: "2026-05", project: "RH Kids Promotion", billingItem: "A4 Design", amountUsd: "75", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Historical design item; invoice/payment not explicitly confirmed here" },
  { row: 20, month: "2026-05", project: "RH Kids Menu", billingItem: "A4", amountUsd: "25", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Invoice/payment unconfirmed" },
  { row: 21, month: "2026-05", project: "RH Kids Menu", billingItem: "iStand", amountUsd: "25", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Invoice/payment unconfirmed" },
  { row: 22, month: "2026-05", project: "RH SNS Campaign", billingItem: "A5 Design", amountUsd: "75", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Invoice/payment unconfirmed" },
  { row: 23, month: "2026-05", project: "RH SNS Campaign", billingItem: "Print 60", amountUsd: "21", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Amount known; invoice/payment unconfirmed" },
  { row: 24, month: "2026-05", project: "RH SNS Campaign", billingItem: "Additional Print 20", amountUsd: "", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Possible missed add-on; amount/invoice/payment unconfirmed" },
  { row: 25, month: "2026-05", project: "RH Shrimp Ramen", billingItem: "A4 Design", amountUsd: "75", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Invoice/payment unconfirmed" },
  { row: 26, month: "2026-05", project: "RH Shrimp Ramen", billingItem: "iStand", amountUsd: "25", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Invoice/payment unconfirmed" },
  { row: 27, month: "2026-05", project: "RH FREE Voucher", billingItem: "Design", amountUsd: "", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Old $40 provisional superseded by June recap $75; keep unresolved here" },
  { row: 28, month: "2026-05", project: "RH FREE Voucher", billingItem: "Print 3000", amountUsd: "180", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Later June recap includes this; historical placement/payment unconfirmed" },
  { row: 29, month: "2026-06", project: "FREE Voucher", billingItem: "Design (2 designs)", amountUsd: "75", invoiceFact: "YES", paymentFact: "", status: "INVOICED", note: "Confirmed in June billing recap; payment date unconfirmed" },
  { row: 30, month: "2026-06", project: "FREE Voucher", billingItem: "Print 3000", amountUsd: "180", invoiceFact: "YES", paymentFact: "", status: "INVOICED", note: "Confirmed in June billing recap; payment date unconfirmed" },
  { row: 31, month: "2026-06", project: "FREE Voucher", billingItem: "Additional Print 700", amountUsd: "42", invoiceFact: "YES", paymentFact: "", status: "INVOICED", note: "Confirmed in June billing recap; payment date unconfirmed" },
  { row: 32, month: "2026-06", project: "Vietnam Design", billingItem: "Design", amountUsd: "75", invoiceFact: "YES", paymentFact: "", status: "INVOICED", note: "Confirmed in June billing recap; payment date unconfirmed" },
  { row: 33, month: "2026-06", project: "Chip Mong POP", billingItem: "Design", amountUsd: "75", invoiceFact: "YES", paymentFact: "", status: "INVOICED", note: "Confirmed in June billing recap; payment date unconfirmed" },
  { row: 34, month: "2026-06", project: "Chip Mong POP", billingItem: "B1 Resize", amountUsd: "25", invoiceFact: "YES", paymentFact: "", status: "INVOICED", note: "Confirmed in June billing recap; payment date unconfirmed" },
  { row: 35, month: "2026-06", project: "A4 Laminate", billingItem: "Print x15", amountUsd: "12", invoiceFact: "YES", paymentFact: "", status: "INVOICED", note: "Confirmed in June billing recap; payment date unconfirmed" },
  { row: 36, month: "2026-06", project: "B1 Board", billingItem: "Board", amountUsd: "25", invoiceFact: "YES", paymentFact: "", status: "INVOICED", note: "Confirmed in June billing recap; payment date unconfirmed" },
  { row: 37, month: "2026-06", project: "Digital Signature", billingItem: "Portrait + Landscape", amountUsd: "75", invoiceFact: "YES", paymentFact: "", status: "INVOICED", note: "Confirmed in June billing recap; payment date unconfirmed" },
  { row: 38, month: "2026-06", project: "Vegetable Design", billingItem: "Design", amountUsd: "49", invoiceFact: "YES", paymentFact: "", status: "INVOICED", note: "Confirmed in June billing recap; payment date unconfirmed" },
  { row: 39, month: "2026-06", project: "Sticker & Board", billingItem: "28 units", amountUsd: "112", invoiceFact: "YES", paymentFact: "", status: "INVOICED", note: "Confirmed in June billing recap; payment date unconfirmed" },
  { row: 40, month: "2026-06", project: "Install", billingItem: "Install", amountUsd: "0", invoiceFact: "YES", paymentFact: "", status: "INVOICED", note: "Confirmed in June billing recap; payment date unconfirmed" },
  { row: 41, month: "2026-06", project: "Monitor Stand POP", billingItem: "", amountUsd: "", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Possible June item; invoice/payment unconfirmed" },
  { row: 42, month: "2026-07", project: "Champon", billingItem: "iStand", amountUsd: "45", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Invoice/payment unconfirmed" },
  { row: 43, month: "2026-07", project: "Sign BKK", billingItem: "", amountUsd: "", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Amount/status unconfirmed" },
  { row: 44, month: "2026-07", project: "Sharing Combo", billingItem: "Design", amountUsd: "75", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Invoice/payment unconfirmed" },
  { row: 45, month: "2026-07", project: "Chilled & Yakiniku", billingItem: "Design", amountUsd: "75", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Invoice/payment unconfirmed" },
  { row: 46, month: "2026-07", project: "MONTH-END SPECIAL", billingItem: "A4", amountUsd: "75", invoiceFact: "YES", paymentFact: "", status: "INVOICED", note: "Invoice-complete confirmed; payment not separately confirmed" },
  { row: 47, month: "2026-07", project: "MONTH-END SPECIAL", billingItem: "iStand", amountUsd: "25", invoiceFact: "YES", paymentFact: "", status: "INVOICED", note: "Invoice-complete confirmed; payment not separately confirmed" },
  { row: 48, month: "2026-07", project: "MONTH-END SPECIAL", billingItem: "CC Monitor x2", amountUsd: "30", invoiceFact: "YES", paymentFact: "", status: "INVOICED", note: "Invoice-complete confirmed; payment not separately confirmed" },
  { row: 49, month: "2026-07", project: "FREE Voucher", billingItem: "Revision", amountUsd: "", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Amount/invoice/payment unconfirmed" },
  { row: 50, month: "2026-07", project: "FREE Voucher", billingItem: "Additional Print 1500", amountUsd: "", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Amount/invoice/payment unconfirmed" },
  { row: 51, month: "2026-07", project: "Free Iced Tea", billingItem: "Custom Size", amountUsd: "20", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Invoice/payment unconfirmed" },
  { row: 52, month: "2026-07", project: "Free Iced Tea", billingItem: "Print x90", amountUsd: "", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Amount/invoice/payment unconfirmed" },
  { row: 53, month: "2026-07", project: "Tonkatsu Promo", billingItem: "A4", amountUsd: "75", invoiceFact: "YES", paymentFact: "", status: "INVOICED", note: "Later confirmed already billed; payment not separately confirmed" },
  { row: 54, month: "2026-08", project: "Chilled & Yakiniku", billingItem: "iStand Resize", amountUsd: "25", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Later add-on; invoice/payment unconfirmed" },
  { row: 55, month: "2026-08", project: "Tonkatsu Promo", billingItem: "A4", amountUsd: "75", invoiceFact: "YES", paymentFact: "", status: "INVOICED", note: "Confirmed already billed on Aug 25; payment unconfirmed" },
  { row: 56, month: "2026-08", project: "Pay Day Campaign", billingItem: "A5", amountUsd: "45", invoiceFact: "YES", paymentFact: "", status: "INVOICED", note: "Aug 25 recap says $45; earlier $75 discrepancy exists, keep note" },
  { row: 57, month: "2026-08", project: "Pay Day Campaign", billingItem: "Resize", amountUsd: "25", invoiceFact: "YES", paymentFact: "", status: "INVOICED", note: "Confirmed already billed; payment unconfirmed" },
  { row: 58, month: "2026-08", project: "Pay Day Campaign", billingItem: "A4 Resize", amountUsd: "25", invoiceFact: "YES", paymentFact: "", status: "INVOICED", note: "Confirmed already billed; payment unconfirmed" },
  { row: 59, month: "2026-08", project: "Home Fair Special Set", billingItem: "A4", amountUsd: "75", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Current candidate at last reconciliation; invoice/payment not confirmed" },
  { row: 60, month: "2026-08", project: "Home Fair Special Set", billingItem: "iStand", amountUsd: "25", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Current candidate at last reconciliation; invoice/payment not confirmed" },
  { row: 61, month: "2026-08", project: "ID Card Promo", billingItem: "A5", amountUsd: "45", invoiceFact: "YES", paymentFact: "", status: "INVOICED", note: "Confirmed already billed; payment unconfirmed" },
  { row: 62, month: "2026-08", project: "ID Card Promo", billingItem: "Monitor Resize", amountUsd: "25", invoiceFact: "YES", paymentFact: "", status: "INVOICED", note: "Confirmed already billed; payment unconfirmed" },
  { row: 63, month: "2026-08", project: "Deliver Banner", billingItem: "Banner x4", amountUsd: "60", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Current candidate at last reconciliation; invoice/payment not confirmed" },
  { row: 64, month: "2026-08", project: "Lunch Menu", billingItem: "A3 Custom", amountUsd: "125", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Current candidate; invoice/payment not confirmed" },
  { row: 65, month: "2026-08", project: "Lunch Menu", billingItem: "iStand", amountUsd: "25", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Current candidate; invoice/payment not confirmed" },
  { row: 66, month: "2026-08", project: "Lunch Menu", billingItem: "SNS Resize", amountUsd: "25", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Current candidate; invoice/payment not confirmed" },
  { row: 67, month: "2026-08", project: "Lunch Menu", billingItem: "Print A3 x40", amountUsd: "", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Do not apply $1.25/pc without confirmation" },
  { row: 68, month: "2026-08", project: "Beef Champon", billingItem: "A4", amountUsd: "75", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Current candidate; invoice/payment not confirmed" },
  { row: 69, month: "2026-08", project: "Beef Champon", billingItem: "iStand", amountUsd: "25", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Current candidate; invoice/payment not confirmed" },
  { row: 70, month: "2026-08", project: "Spicy Egg Voucher", billingItem: "NameCard", amountUsd: "10", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Current candidate; invoice/payment not confirmed" },
  { row: 71, month: "2026-08", project: "Spicy Egg Voucher", billingItem: "Print x100", amountUsd: "15", invoiceFact: "", paymentFact: "", status: "NEEDS_REVIEW", note: "Current candidate; invoice/payment not confirmed" },
];

const HISTORY_CLIENT_ID = "cl_ringer_hut";
const HISTORY_CREATED_BY = "Import";

export interface HistoricalData {
  projects: Project[];
  billingItems: BillingItem[];
}

export function buildRingerHutHistory(now: string): HistoricalData {
  const projectsByName = new Map<string, Project>();
  const projects: Project[] = [];
  const billingItems: BillingItem[] = [];

  for (const row of RINGER_HUT_HISTORY) {
    let project = projectsByName.get(row.project);
    if (!project) {
      project = {
        id: historicalProjectId(row.project),
        clientId: HISTORY_CLIENT_ID,
        name: row.project,
        date: monthDate(row.month),
        createdAt: now,
        createdBy: HISTORY_CREATED_BY,
        updatedAt: now,
        updatedBy: HISTORY_CREATED_BY,
        deletedAt: null,
      };
      projectsByName.set(row.project, project);
      projects.push(project);
    }

    const amount = parseAmount(row.amountUsd);
    const type = itemType(row.billingItem);
    const delivered = row.status === "INVOICED";
    billingItems.push({
      id: historicalItemId(row.row),
      projectId: project.id,
      description: row.billingItem,
      type,
      quantity: 1,
      unitPrice: amount,
      amount,
      customAmount: true,
      productionStatus: delivered ? "DELIVERED" : "IN_PROGRESS",
      billingStatus: row.status,
      deliveredAt: null,
      deliveredBy: null,
      invoiceId: null,
      historicalMonth: row.month,
      note: row.note,
      createdAt: now,
      createdBy: HISTORY_CREATED_BY,
      updatedAt: now,
      updatedBy: HISTORY_CREATED_BY,
      deletedAt: null,
    });
  }

  return { projects, billingItems };
}

/**
 * Merge only missing imported rows. Existing operational edits and existing
 * browser state are left untouched; matching legacy imported rows are consumed
 * one-for-one so repeated reads cannot duplicate history.
 */
export function mergeRingerHutHistory(db: Database, now: string): Database {
  const source = buildRingerHutHistory(now);
  const importedProjects = db.projects.filter(
    (project) => project.clientId === HISTORY_CLIENT_ID && project.createdBy === HISTORY_CREATED_BY,
  );
  const projectByName = new Map(importedProjects.map((project) => [project.name, project]));
  const projectIds = new Set(db.projects.map((project) => project.id));

  for (const project of source.projects) {
    if (projectByName.has(project.name)) continue;
    if (!projectIds.has(project.id)) {
      db.projects.push(project);
      projectIds.add(project.id);
      projectByName.set(project.name, project);
    }
  }

  const existingByFingerprint = new Map<string, number>();
  for (const item of db.billingItems) {
    if (item.createdBy !== HISTORY_CREATED_BY) continue;
    const project = db.projects.find((candidate) => candidate.id === item.projectId);
    if (!project || project.clientId !== HISTORY_CLIENT_ID) continue;
    const key = historyFingerprint(
      project.name,
      item.historicalMonth ?? historicalMonthFromNote(item.note) ?? project.date.slice(0, 7),
      item.description,
      item.amount,
      item.billingStatus,
      item.note,
    );
    existingByFingerprint.set(key, (existingByFingerprint.get(key) ?? 0) + 1);
  }

  const itemIds = new Set(db.billingItems.map((item) => item.id));
  for (const item of source.billingItems) {
    const project = source.projects.find((candidate) => candidate.id === item.projectId);
    if (!project) continue;
    const targetProject = projectByName.get(project.name) ?? project;
    const stableIdTaken = itemIds.has(item.id);
    const key = historyFingerprint(
      project.name,
      item.historicalMonth ?? "",
      item.description,
      item.amount,
      item.billingStatus,
      item.note,
    );
    const existingCount = existingByFingerprint.get(key) ?? 0;
    if (stableIdTaken || existingCount > 0) {
      if (existingCount > 0) existingByFingerprint.set(key, existingCount - 1);
      continue;
    }
    db.billingItems.push({ ...item, projectId: targetProject.id });
    itemIds.add(item.id);
  }

  return db;
}

function historicalProjectId(name: string): string {
  const encoded = encodeURIComponent(name.trim().toLowerCase()).replace(/%/g, "_");
  return `pj_history_rh_${encoded.replace(/[^a-z0-9_-]/g, "_") || "unconfirmed"}`;
}

function historicalItemId(row: number): string {
  return `bi_history_rh_${String(row).padStart(3, "0")}`;
}

function monthDate(month: string): string {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? `${month}-01` : "1970-01-01";
}

function parseAmount(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function itemType(value: string): ItemType {
  const normalized = value.toUpperCase();
  if (normalized.includes("DESIGN")) return "DESIGN";
  if (normalized.includes("RESIZE")) return "RESIZE";
  if (normalized.includes("PRINT")) return "PRINT";
  return "OTHER";
}

function historicalMonthFromNote(note?: string): string | null {
  const match = note?.match(/Historical month (\d{4}-(?:0[1-9]|1[0-2]))/i);
  return match?.[1] ?? null;
}

function historyFingerprint(
  project: string,
  month: string,
  description: string,
  amount: number,
  status: string,
  note?: string,
): string {
  const normalizedDescription = description || "(unconfirmed)";
  const normalizedNote = (note ?? "").replace(
    /; Historical month \d{4}-(?:0[1-9]|1[0-2]); exact work date unknown$/i,
    "",
  );
  return [project, month, normalizedDescription, amount, status, normalizedNote]
    .map((value) => String(value).trim().toLowerCase())
    .join("\u001f");
}
