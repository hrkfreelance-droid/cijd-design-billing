import { Store } from "@/lib/data/store";
import type { Database } from "@/lib/types";
import { d1Persistence, type D1DatabaseLike } from "./d1-persistence";

/**
 * The V5 Worker hands its bindings over here (see worker/index.ts) before any
 * route runs, so route handlers reach V5's own D1 database — and only that.
 */
interface V5Env {
  V5_DB?: D1DatabaseLike;
}

const ENV_KEY = "__cijdV5Env";

export function setV5Env(env: unknown): void {
  (globalThis as Record<string, unknown>)[ENV_KEY] = env;
}

function v5Database(): D1DatabaseLike {
  const env = (globalThis as Record<string, unknown>)[ENV_KEY] as V5Env | undefined;
  if (!env?.V5_DB) throw new Error("The V5 D1 binding (V5_DB) is not available.");
  return env.V5_DB;
}

/** V5 starts empty: no V3 records are copied in, and none are ever read. */
export function buildV5Seed(): Database {
  const now = new Date().toISOString();
  const db: Database = {
    clients: [],
    projects: [],
    billingItems: [],
    invoices: [],
    invoiceItems: [],
    payments: [],
    users: [
      { id: "u_designer", name: "Designer", role: "DESIGNER" },
      { id: "u_accounting", name: "Accounting", role: "ACCOUNTING" },
      { id: "u_admin", name: "Admin", role: "ADMIN" },
    ],
    auditLogs: [],
    telegramSessions: [],
    notifications: [],
    exchangeRates: [],
    exchangeRateFailures: [],
    serviceTypes: [
      { id: "st_design", key: "DESIGN", name: "Design", active: true, createdAt: now },
      { id: "st_printing", key: "PRINTING", name: "Printing", active: true, createdAt: now },
      { id: "st_passport", key: "PASSPORT", name: "Passport", active: true, createdAt: now },
      { id: "st_other", key: "OTHER", name: "Other", active: true, createdAt: now },
    ],
    projectPayments: [],
    clientTaxProfiles: [],
    taxInvoices: [],
  };
  // Local E2E runs offline; an explicit test rate keeps it deterministic.
  const testRate = Number(process.env.CIJD_TEST_NBC_RATE);
  if (process.env.CIJD_TEST_MODE === "1" && Number.isFinite(testRate) && testRate > 0) {
    db.exchangeRates.push({
      id: "test-nbc-usd-khr",
      currencyPair: "USD/KHR",
      rate: testRate,
      source: "NBC",
      effectiveDate: process.env.CIJD_TEST_NBC_RATE_DATE ?? "2026-09-01",
      fetchedAt: now,
    });
  }
  return db;
}

/**
 * A Store per request: the Store is only a rules engine over whatever the
 * persistence reads, and D1 is the single source of truth between isolates.
 */
export function getV5Repository(): Store {
  return new Store(d1Persistence(v5Database(), buildV5Seed));
}

/** Direct access for the one-time V3 import (read, replace, read back). */
export function getV5Persistence() {
  return d1Persistence(v5Database(), buildV5Seed);
}

export function v5Secret(name: string): string | undefined {
  const env = (globalThis as Record<string, unknown>)[ENV_KEY] as Record<string, unknown> | undefined;
  const value = env?.[name] ?? process.env[name];
  return typeof value === "string" && value ? value : undefined;
}
