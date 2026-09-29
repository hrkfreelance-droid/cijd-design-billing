/**
 * V5's data boundary: the V3 Store (the same rules V3's local mode runs),
 * persisted in V5's own Cloudflare D1 database.
 *
 *   v5_meta                 one row: a version number and the last writer
 *   v5_state                one JSON row per collection (clients, projects…)
 *   v5_audit_log            append-only audit trail
 *   v5_tax_invoice_archive  append-only copy of every issued Tax Invoice
 *
 * Writes are optimistic: a write only lands if nobody else wrote since this
 * copy was read, and everything in one Store transaction commits together
 * (a D1 batch is one SQLite transaction). Nothing here ever reads or writes
 * V3's Supabase or V4's D1 database.
 */
import { RuleError } from "@/lib/data/repository";
import type { Persistence } from "@/lib/data/store";
import type { Database, TaxInvoiceRecord } from "@/lib/types";

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}

export interface D1DatabaseLike {
  prepare(sql: string): D1PreparedStatementLike;
  batch(statements: D1PreparedStatementLike[]): Promise<{ meta: { changes: number } }[]>;
}

/** What was read, so the write can tell what changed and whether it is stale. */
interface ReadState {
  version: number;
  json: Map<string, string>;
}

const COLLECTIONS = [
  "clients",
  "projects",
  "billingItems",
  "invoices",
  "invoiceItems",
  "payments",
  "users",
  "telegramSessions",
  "notifications",
  "exchangeRates",
  "exchangeRateFailures",
  "serviceTypes",
  "projectPayments",
  "clientTaxProfiles",
  "taxInvoices",
] as const satisfies readonly (keyof Database)[];

export class ConflictError extends RuleError {
  constructor() {
    super("CONFLICT", "Someone else saved at the same time. Reload and try again.", 409);
  }
}

export function d1Persistence(db: D1DatabaseLike, seed: () => Database): Persistence {
  const reads = new WeakMap<Database, ReadState>();

  return {
    async read() {
      const meta = await db.prepare("SELECT version FROM v5_meta WHERE id = 1").first<{ version: number }>();
      if (!meta) throw new Error("V5 database is not migrated (v5_meta is missing).");
      const version = Number(meta.version);
      const { results } = await db
        .prepare("SELECT collection, data FROM v5_state")
        .all<{ collection: string; data: string }>();

      const json = new Map<string, string>();
      if (version === 0 && results.length === 0) {
        // A fresh V5 database: start from V5's own seed, written on first save.
        const initial = seed();
        reads.set(initial, { version, json });
        return initial;
      }

      const loaded = { auditLogs: [] } as unknown as Database;
      for (const row of results) {
        json.set(row.collection, row.data);
        (loaded as unknown as Record<string, unknown>)[row.collection] = JSON.parse(row.data);
      }
      for (const key of COLLECTIONS) {
        if (!Array.isArray((loaded as unknown as Record<string, unknown>)[key])) {
          (loaded as unknown as Record<string, unknown>)[key] = [];
        }
      }
      reads.set(loaded, { version, json });
      return loaded;
    },

    async write(next) {
      const state = reads.get(next);
      if (!state) throw new Error("V5 write without a matching read.");
      const token = globalThis.crypto.randomUUID();
      const at = new Date().toISOString();
      const mine = "(SELECT writer FROM v5_meta WHERE id = 1) = ?";

      const statements: D1PreparedStatementLike[] = [
        db
          .prepare("UPDATE v5_meta SET version = version + 1, writer = ?, updated_at = ? WHERE id = 1 AND version = ?")
          .bind(token, at, state.version),
      ];

      const written = new Map<string, string>();
      for (const key of COLLECTIONS) {
        const data = JSON.stringify((next as unknown as Record<string, unknown>)[key] ?? []);
        if (state.json.get(key) === data) continue;
        written.set(key, data);
        statements.push(
          db
            .prepare(
              `INSERT INTO v5_state (collection, data, updated_at) SELECT ?, ?, ? WHERE ${mine}
               ON CONFLICT(collection) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
            )
            .bind(key, data, at, token),
        );
      }

      for (const entry of next.auditLogs ?? []) {
        statements.push(
          db
            .prepare(
              `INSERT OR IGNORE INTO v5_audit_log (id, at, actor, action, entity, entity_id, detail)
               SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${mine}`,
            )
            .bind(entry.id, entry.at, entry.actor, entry.action, entry.entity, entry.entityId, entry.detail ?? null, token),
        );
      }

      for (const invoice of (next.taxInvoices ?? []) as TaxInvoiceRecord[]) {
        statements.push(
          db
            .prepare(
              `INSERT OR IGNORE INTO v5_tax_invoice_archive (id, invoice_number, snapshot, issued_at)
               SELECT ?, ?, ?, ? WHERE ${mine}`,
            )
            // First write wins: the archive keeps the invoice as it was issued.
            .bind(invoice.id, invoice.invoiceNumber, JSON.stringify(invoice), invoice.issuedAt, token),
        );
      }

      const results = await db.batch(statements);
      if (results[0]?.meta.changes !== 1) throw new ConflictError();

      // This copy is now the latest; a further write from it builds on it.
      next.auditLogs = [];
      for (const [key, data] of written) state.json.set(key, data);
      state.version += 1;
    },
  };
}
