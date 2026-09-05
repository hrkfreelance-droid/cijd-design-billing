/** Runtime switches shared by server and client code. */
const PREVIEW_HOST = "cijd-design-billing-preview.hrk-freelance.workers.dev";
const isPreviewHost =
  typeof window !== "undefined" && window.location.hostname === PREVIEW_HOST;

export const isPreviewRuntime =
  process.env.CIJD_PREVIEW_MODE === "1" || isPreviewHost;

/**
 * The fixed Cloudflare Review Worker is a public demo. On the server the
 * explicit Worker var enables demo routing; in the browser the fixed hostname
 * is enough to select the isolated localStorage-backed demo repository.
 */
export const isPublicDemoRuntime =
  process.env.CIJD_PUBLIC_DEMO_MODE === "1" || isPreviewHost;

/** Local demo remains available for development without affecting other hosts. */
const isLocalDevelopmentDemo =
  process.env.NEXT_PUBLIC_DEMO_MODE === "1" &&
  process.env.NODE_ENV === "development" &&
  !isPreviewRuntime;

export const isDemoMode = isPublicDemoRuntime || isLocalDevelopmentDemo;

export const hasSupabaseBrowserConfig = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

/**
 * In demo mode data lives only in the visitor's browser. Server data routes are
 * disabled, so the public demo never reads or writes the operational Supabase
 * repository even when Supabase environment variables exist on the Worker.
 */
export const isLocalDemoRuntime = isDemoMode;

/**
 * Pilot mode is intentionally separate from public demo mode. Pilot grants a
 * server-side ADMIN identity and must never be used to make the public demo
 * accessible.
 */
export function isPilotMode(): boolean {
  return process.env.CIJD_PILOT_MODE === "1";
}

export function isBrowserDemoMode(): boolean {
  return isDemoMode;
}
