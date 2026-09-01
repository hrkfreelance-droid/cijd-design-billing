/** Runtime switches shared by server and client code.
 *
 * An explicit local demo is a development-only feature. In a production build
 * the flag is deliberately ignored so it can never bypass authentication or
 * make browser-local data look like the operational ledger.
 */
export const isDemoMode =
  process.env.NEXT_PUBLIC_DEMO_MODE === "1" && process.env.NODE_ENV !== "production";

/** Cloudflare Preview is also allowed to be the real Supabase application. */
export const isPreviewRuntime = process.env.CIJD_PREVIEW_MODE === "1";

export const hasSupabaseBrowserConfig = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

/** Browser-local data is opt-in for local review, never an implicit Preview fallback. */
export const isLocalDemoRuntime = isDemoMode;

/**
 * A hostname alone must never select demo data. Preview is operational whenever
 * Supabase variables are present, and otherwise stays behind the auth gate.
 */
export function isBrowserDemoMode(): boolean {
  return isDemoMode;
}
