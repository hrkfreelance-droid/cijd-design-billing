// Node 22's built-in SQLite; @types/node 20 does not describe it yet.
declare module "node:sqlite" {
  interface StatementSync {
    get(...values: unknown[]): unknown;
    all(...values: unknown[]): unknown[];
    run(...values: unknown[]): { changes: number | bigint };
  }
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
  }
}
