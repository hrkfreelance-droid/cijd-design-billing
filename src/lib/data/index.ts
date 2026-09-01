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
