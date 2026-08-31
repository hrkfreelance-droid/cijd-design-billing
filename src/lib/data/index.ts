import { filePersistence } from "./file-persistence";
import { Store, type Persistence } from "./store";
import type { Repository } from "./repository";
import { buildDemoSeed } from "./demo-seed";
import { isPreviewRuntime } from "@/lib/runtime";
import type { Database } from "@/lib/types";

/**
 * Single switch point for the data layer.
 *
 * With Supabase configured every request gets a client bound to the caller's
 * session, so row level security applies. Without it the app runs on the local
 * JSON store, which keeps development and the demo usable with no credentials.
 */
let localStore: Repository | null = null;

let previewDb: Database | null = null;
const previewPersistence: Persistence = {
  async read() {
    if (!previewDb) previewDb = buildDemoSeed();
    return previewDb;
  },
  async write(db) {
    previewDb = db;
  },
};

export function getLocalRepository(): Repository {
  if (!localStore) {
    localStore = new Store(isPreviewRuntime ? previewPersistence : filePersistence);
  }
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

/** For entry points with no browser session, such as the Telegram bot. */
export async function getServiceRepository(): Promise<Repository> {
  const { dataMode } = await import("@/lib/supabase/config");
  if (dataMode() === "local") return getLocalRepository();
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
