import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

import { currentAccessUser } from "@/lib/auth/access-links";
import { isPilotMode } from "@/lib/runtime";
import { supabaseConfig } from "./config";

/**
 * Google sessions use a client bound to the caller's session. Access-link
 * sessions have no Supabase Auth JWT, so the server-only service key is used
 * for the database request and GuardedRepository remains the application-level
 * Role boundary for every read and write.
 */
export async function supabaseServerClient(
  options?: { forAuth?: boolean },
): Promise<SupabaseClient | null> {
  const config = supabaseConfig();
  if (!config) return null;
  const accessUser = await currentAccessUser();
  // Pilot and Access Link requests have no Supabase Auth JWT. Use the
  // server-only service key for their shared-database request. OAuth callback
  // exchange explicitly opts out so Google Auth remains available while Pilot
  // Mode is enabled.
  if ((accessUser || isPilotMode()) && !options?.forAuth) {
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!serviceRoleKey) return null;
    return createClient(config.url, serviceRoleKey, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    });
  }
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
