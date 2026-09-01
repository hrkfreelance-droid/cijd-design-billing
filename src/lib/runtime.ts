/** Runtime switches shared by server and client code.
 *
 * A public demo is a development/preview feature only. In a production build
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

/** The browser-local store is only a deliberate fallback for an unconfigured preview. */
export const isLocalDemoRuntime =
  isDemoMode || (isPreviewRuntime && !hasSupabaseBrowserConfig);

const PREVIEW_HOST = "cijd-design-billing-preview.hrk-freelance.workers.dev";

/**
 * A hostname alone must never select demo data. Once the public preview has
 * its Supabase build variables, it uses the same operational API as production.
 */
export function isBrowserDemoMode(): boolean {
  if (isDemoMode) return true;
  return (
    typeof window !== "undefined" &&
    window.location.hostname === PREVIEW_HOST &&
    !hasSupabaseBrowserConfig
  );
}
