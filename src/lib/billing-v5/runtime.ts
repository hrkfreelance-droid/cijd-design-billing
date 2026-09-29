/**
 * V5 runs the V3 screens on its own Worker and its own data. The screens are
 * shared, so the few places where V5 writes more (the stored Final mode) ask
 * this instead of guessing from data.
 */
export const V5_BASE = "/office-v5";

/** In the browser: this page belongs to V5. */
export function isV5Client(): boolean {
  return typeof window !== "undefined" && window.location.pathname.startsWith(V5_BASE);
}

/** On the server: this process is the V5 Worker (isolated D1 data, no Supabase). */
export function isV5Server(): boolean {
  return process.env.CIJD_V5_MODE === "1";
}
