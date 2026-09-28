export type D1Value = string | number | null | ArrayBuffer | ArrayBufferView;

export interface D1Meta {
  changes: number;
  rows_read: number;
  rows_written: number;
  last_row_id: number;
}

export interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: D1Meta;
  error?: string;
}

export interface D1PreparedStatement {
  bind(...values: D1Value[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}
