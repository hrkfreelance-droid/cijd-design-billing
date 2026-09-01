import { filePersistence } from "./file-persistence";
import { Store } from "./store";
import type { Repository } from "./repository";
import { currentAccessUser } from "@/lib/auth/access-links";

/**
 * Single switch point for the data layer.
 *
 * With Supabase configured, Google sessions use the caller's RLS-bound client;
 * Access Link sessions use the server-only service key and the GuardedRepository
 * role boundary. A local JSON store is only selected during local development.
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
  const accessUser = await currentAccessUser();
  return new SupabaseRepository(client, accessUser?.role ?? null);
}

export { RuleError } from "./repository";
export type { Repository } from "./repository";
