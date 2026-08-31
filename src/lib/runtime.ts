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
 * Supabase credentials. This server-only flag selects an ephemeral preview
 * store; it is never exposed as a NEXT_PUBLIC value and does not bypass the
 * normal cookie and repository authorization checks.
 */
export const isPreviewRuntime =
  process.env.CIJD_PREVIEW_MODE === "1" && process.env.NODE_ENV === "production";

export const hasSupabaseBrowserConfig = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);
