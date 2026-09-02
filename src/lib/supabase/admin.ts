import { createClient } from "@supabase/supabase-js";

import { supabaseConfig } from "./config";

/** Server-only Supabase client for CIJD Admin operations. */
export function supabaseAdminClient() {
  const config = supabaseConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!config || !serviceRoleKey) return null;
  return createClient(config.url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
