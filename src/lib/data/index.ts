import { filePersistence } from "./file-persistence";
import { Store } from "./store";
import type { Repository } from "./repository";

/**
 * Single switch point for the data layer.
 *
 * With Supabase configured every request gets a client bound to the caller's
 * session, so row level security applies. Without it the app runs on the local
 * JSON store, which keeps development and the demo usable with no credentials.
 */
let localStore: Repository | null = null;

export function getLocalRepository(): Repository {
  if (!localStore) localStore = new Store(filePersistence);
  return localStore;
}

export async function getRepository(): Promise<Repository> {
  const { supabaseEnabled } = await import("@/lib/supabase/config");
  if (!supabaseEnabled()) return getLocalRepository();
  const { supabaseServerClient } = await import("@/lib/supabase/server");
  const client = await supabaseServerClient();
  if (!client) return getLocalRepository();
  const { SupabaseRepository } = await import("@/lib/supabase/repository");
  return new SupabaseRepository(client);
}

/** For entry points with no browser session, such as the Telegram bot. */
export async function getServiceRepository(): Promise<Repository> {
  const { supabaseEnabled } = await import("@/lib/supabase/config");
  if (!supabaseEnabled()) return getLocalRepository();
  const { supabaseServiceClient } = await import("@/lib/supabase/server");
  const client = await supabaseServiceClient();
  if (!client) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for the Telegram endpoint.");
  }
  const { SupabaseRepository } = await import("@/lib/supabase/repository");
  return new SupabaseRepository(client);
}

export { RuleError } from "./repository";
export type { Repository } from "./repository";
