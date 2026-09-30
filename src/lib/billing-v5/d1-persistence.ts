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
  "customers",
  "products",
  "billingAllocations",
  "invoicePayments",
  "invoiceRevisions",
] as const satisfies readonly (keyof Database)[];

export class ConflictError extends RuleError {
  constructor() {
    super("CONFLICT", "Someone else saved at the same time. Reload and try again.", 409);
  }
}

/**
 * D1 caps a single value at 2 MB. Collections are stored in chunks well below
 * that, split between records (never inside one), so any size fits.
 */
export const DEFAULT_CHUNK_BYTES = 900_000;

function parseChunkKey(key: string): { name: string; index: number } {
  const at = key.indexOf("#");
  return at < 0 ? { name: key, index: 0 } : { name: key.slice(0, at), index: Number(key.slice(at + 1)) };
}

const encoder = new TextEncoder();

export function chunkCollection(items: readonly unknown[] | undefined, maxBytes: number): string[] {
  const list = items ?? [];
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 2;
  for (const item of list) {
    const text = JSON.stringify(item);
    const bytes = encoder.encode(text).length + 1;
    if (current.length && size + bytes > maxBytes) {
      chunks.push(`[${current.join(",")}]`);
      current = [];
      size = 2;
    }
    current.push(text);
    size += bytes;
  }
  chunks.push(`[${current.join(",")}]`);
  return chunks;
}

export function d1Persistence(
  db: D1DatabaseLike,
  seed: () => Database,
  { chunkBytes = DEFAULT_CHUNK_BYTES }: { chunkBytes?: number } = {},
): Persistence {
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

      // A collection is one row ("billingItems") or, when large, several
      // ("billingItems", "billingItems#1", …) read back in order.
      const parts = new Map<string, { index: number; data: string }[]>();
      for (const row of results) {
        json.set(row.collection, row.data);
        const { name, index } = parseChunkKey(row.collection);
        const list = parts.get(name) ?? [];
        list.push({ index, data: row.data });
        parts.set(name, list);
      }
      const loaded = { auditLogs: [] } as unknown as Database;
      for (const key of COLLECTIONS) {
        const list = (parts.get(key) ?? []).sort((a, b) => a.index - b.index);
        (loaded as unknown as Record<string, unknown>)[key] = list.flatMap((part) => JSON.parse(part.data) as unknown[]);
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
      const removed: string[] = [];
      for (const key of COLLECTIONS) {
        const chunks = chunkCollection((next as unknown as Record<string, unknown>)[key] as unknown[] | undefined, chunkBytes);
        chunks.forEach((data, index) => {
          const chunkKey = index === 0 ? key : `${key}#${index}`;
          if (state.json.get(chunkKey) === data) return;
          written.set(chunkKey, data);
          statements.push(
            db
              .prepare(
                `INSERT INTO v5_state (collection, data, updated_at) SELECT ?, ?, ? WHERE ${mine}
                 ON CONFLICT(collection) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
              )
              .bind(chunkKey, data, at, token),
          );
        });
        // A collection that shrank leaves no stale tail chunks behind.
        for (const existing of state.json.keys()) {
          const { name, index } = parseChunkKey(existing);
          if (name === key && index >= chunks.length) {
            removed.push(existing);
            statements.push(db.prepare(`DELETE FROM v5_state WHERE collection = ? AND ${mine}`).bind(existing, token));
          }
        }
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

      // Every invoice revision, as recorded. Insert-only (see migrations-v5/0002).
      for (const revision of next.invoiceRevisions ?? []) {
        statements.push(
          db
            .prepare(
              `INSERT OR IGNORE INTO v5_invoice_revisions (id, invoice_id, revision, action, changed_at, changed_by, snapshot)
               SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${mine}`,
            )
            .bind(revision.id, revision.invoiceId, revision.revision, revision.action, revision.changedAt, revision.changedBy, JSON.stringify(revision), token),
        );
      }

      const results = await db.batch(statements);
      if (results[0]?.meta.changes !== 1) throw new ConflictError();

      // This copy is now the latest; a further write from it builds on it.
      next.auditLogs = [];
      for (const [key, data] of written) state.json.set(key, data);
      for (const key of removed) state.json.delete(key);
      state.version += 1;
    },
  };
}
