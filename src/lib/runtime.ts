/** Runtime switches shared by server and client code.
 *
 * A public demo is a development/preview feature only. In a production build
 * the flag is deliberately ignored so it can never bypass authentication or
 * make browser-local data look like the operational ledger.
 */
export const isDemoMode =
  process.env.NEXT_PUBLIC_DEMO_MODE === "1" && process.env.NODE_ENV !== "production";

/**
 * Cloudflare Preview is a production build, but it deliberately has no
 * Supabase credentials. This server-only flag identifies the preview runtime
 * so server routes can stay closed while the browser owns the demo state.
 */
export const isPreviewRuntime =
  process.env.CIJD_PREVIEW_MODE === "1";

const PREVIEW_HOST = "cijd-design-billing-preview.hrk-freelance.workers.dev";

/**
 * The public preview is intentionally browser-local. The hostname check keeps
 * the flag out of production client bundles and avoids treating a production
 * build with real Supabase credentials as a demo.
 */
export function isBrowserDemoMode(): boolean {
  if (isDemoMode) return true;
  return typeof window !== "undefined" && window.location.hostname === PREVIEW_HOST;
}

export const hasSupabaseBrowserConfig = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);
