import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseConfig } from "./config";

/**
 * A client bound to the caller's session, so every query runs under that
 * person's row level security policies rather than a privileged key.
 */
export async function supabaseServerClient(): Promise<SupabaseClient | null> {
  const config = supabaseConfig();
  if (!config) return null;
  const store = await cookies();
  return createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a server component: the middleware refreshes instead.
        }
      },
    },
  });
}

/**
 * Used only by the Telegram bot endpoint, which has no browser session. Needs
 * SUPABASE_SERVICE_ROLE_KEY and therefore bypasses RLS — keep its use to that
 * one entry point, which is already behind a shared secret.
 */
export async function supabaseServiceClient(): Promise<SupabaseClient | null> {
  const config = supabaseConfig();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!config || !serviceKey) return null;
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(config.url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
