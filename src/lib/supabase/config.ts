import { isPreviewRuntime } from "@/lib/runtime";

export type DataMode = "local" | "supabase";

/** Supabase is the only data source allowed by a production runtime. */
export function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && anonKey ? { url, anonKey } : null;
}

export const supabaseEnabled = () => supabaseConfig() !== null;

/**
 * Local JSON is intentionally available during development only. A production
 * process without Supabase credentials fails closed instead of silently using
 * `.data/runtime/db.json` or a browser-local store as an operational ledger.
 */
export function dataMode(): DataMode {
  if (supabaseEnabled()) return "supabase";
  if (process.env.NODE_ENV !== "production" && !isPreviewRuntime) return "local";
  // Preview and production fail closed as Supabase applications. The caller
  // will show the auth/setup gate instead of silently opening a local ledger.
  return "supabase";
}
