import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import type { D1DatabaseLike, D1PreparedStatementLike } from "../../src/lib/billing-v5/d1-persistence.ts";

/**
 * A D1-shaped adapter over Node's built-in SQLite, with the real V5 migration
 * applied, so the persistence is tested against actual SQL — batches run in
 * one transaction, exactly as D1 runs them.
 */
export function sqliteD1(): D1DatabaseLike & { raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  raw.exec(readFileSync(new URL("../../migrations-v5/0001_v5_state.sql", import.meta.url), "utf8"));

  function statement(sql: string, values: unknown[] = []): D1PreparedStatementLike {
    const args = () => values.map((value) => (value === undefined ? null : value)) as never[];
    return {
      bind: (...next: unknown[]) => statement(sql, next),
      first: async <T>() => (raw.prepare(sql).get(...args()) as T | undefined) ?? null,
      all: async <T>() => ({ results: raw.prepare(sql).all(...args()) as T[] }),
      run: async () => ({ meta: { changes: Number(raw.prepare(sql).run(...args()).changes) } }),
    };
  }

  return {
    raw,
    prepare: (sql: string) => statement(sql),
    async batch(statements) {
      raw.exec("BEGIN");
      try {
        const results = [];
        for (const entry of statements) results.push(await entry.run());
        raw.exec("COMMIT");
        return results;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
