/**
 * Supabase is used when it is configured, and the JSON store otherwise. One
 * check, so nothing else in the app has to care which is running.
 */
export function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && anonKey ? { url, anonKey } : null;
}

export const supabaseEnabled = () => supabaseConfig() !== null;
