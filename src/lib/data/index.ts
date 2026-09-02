import { filePersistence } from "./file-persistence";
import { Store } from "./store";
import type { Repository } from "./repository";

/**
 * Single switch point for the data layer.
 *
 * With Supabase configured, OAuth sessions use the caller's RLS-bound client.
 * Access Link / Pilot sessions receive a server-only service-role client, but
 * every route is still wrapped by GuardedRepository before it reaches here.
 * Keeping one SupabaseRepository path is important: print cost and billing
 * price writes always go through the same controlled database RPCs instead of
 * a second direct-table implementation drifting out of sync.
 */
let localStore: Repository | null = null;

export function getLocalRepository(): Repository {
  if (!localStore) localStore = new Store(filePersistence);
  return localStore;
}

export async function getRepository(): Promise<Repository> {
  const { dataMode } = await import("@/lib/supabase/config");
  if (dataMode() === "local") return getLocalRepository();
  const { supabaseServerClient } = await import("@/lib/supabase/server");
  const client = await supabaseServerClient();
  if (!client) throw new Error("Supabase server client is unavailable.");
  const { SupabaseRepository } = await import("@/lib/supabase/repository");
  return new SupabaseRepository(client);
}

export { RuleError } from "./repository";
export type { Repository } from "./repository";
