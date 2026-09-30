import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import type { D1DatabaseLike, D1PreparedStatementLike } from "../../src/lib/billing-v5/d1-persistence.ts";

/**
 * A D1-shaped adapter over Node's built-in SQLite, with the real V5 migration
 * applied, so the persistence is tested against actual SQL — batches run in
 * one transaction, exactly as D1 runs them.
 */
export function sqliteD1(options: { through?: string } = {}): D1DatabaseLike & { raw: DatabaseSync; migrate: (file: string) => void } {
  const raw = new DatabaseSync(":memory:");
  const dir = new URL("../../migrations-v5/", import.meta.url);
  const migrate = (file: string) => raw.exec(readFileSync(new URL(file, dir), "utf8"));
  // `through` stops after that migration, to test a database as deployed before a later one.
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()) {
    if (options.through && file > options.through) break;
    migrate(file);
  }

  let queue: Promise<unknown> = Promise.resolve();
  const bound = new WeakMap<D1PreparedStatementLike, { sql: string; args: () => never[] }>();
  const sqlOf = (entry: D1PreparedStatementLike) => bound.get(entry)!.sql;
  const argsOf = (entry: D1PreparedStatementLike) => bound.get(entry)!.args();

  function statement(sql: string, values: unknown[] = []): D1PreparedStatementLike {
    const args = () => values.map((value) => (value === undefined ? null : value)) as never[];
    const self: D1PreparedStatementLike = {
      bind: (...next: unknown[]) => statement(sql, next),
      first: async <T>() => (raw.prepare(sql).get(...args()) as T | undefined) ?? null,
      all: async <T>() => ({ results: raw.prepare(sql).all(...args()) as T[] }),
      run: async () => ({ meta: { changes: Number(raw.prepare(sql).run(...args()).changes) } }),
    };
    bound.set(self, { sql, args });
    return self;
  }

  return {
    raw,
    migrate,
    prepare: (sql: string) => statement(sql),
    // D1 runs each batch as one transaction, one batch at a time.
    batch(statements) {
      const run = queue.then(() => {
        raw.exec("BEGIN");
        try {
          const results = statements.map((entry) => ({ meta: { changes: Number(raw.prepare(sqlOf(entry)).run(...argsOf(entry)).changes) } }));
          raw.exec("COMMIT");
          return results;
        } catch (error) {
          raw.exec("ROLLBACK");
          throw error;
        }
      });
      queue = run.catch(() => undefined);
      return run;
    },
  };
}
