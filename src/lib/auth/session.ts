import { cookies } from "next/headers";

import { getLocalRepository } from "@/lib/data";
import { dataMode } from "@/lib/supabase/config";
import { supabaseServerClient } from "@/lib/supabase/server";
import { currentAccessUser } from "./access-links";
import type { Role } from "./roles";

export const SESSION_COOKIE = "cijd.session";

export type SessionAccess = "active" | "denied" | "signed_out";

export interface SessionUser {
  id: string;
  name: string;
  role: Role;
}

/**
 * Access-link sessions are signed by the matching server Secret and never carry
 * the original URL token. Google/Supabase sessions remain the normal path when
 * no access-link session is present.
 */
export async function currentUser(): Promise<SessionUser | null> {
  const accessUser = await currentAccessUser();
  if (accessUser) return accessUser;

  if (dataMode() === "supabase") {
    const client = await supabaseServerClient();
    if (!client) return null;
    const { data } = await client.auth.getUser();
    if (!data.user) return null;
    const profile = await client
      .from("users")
      .select("id, name, role")
      .eq("id", data.user.id)
      .eq("active", true)
      .maybeSingle();
    if (!profile.data) return null;
    return {
      id: profile.data.id as string,
      name: profile.data.name as string,
      role: profile.data.role as Role,
    };
  }

  const store = await cookies();
  const id = store.get(SESSION_COOKIE)?.value;
  if (!id) return null;
  const users = await getLocalRepository().rawUsers();
  const user = users.find((candidate) => candidate.id === id);
  return user ? { id: user.id, name: user.name, role: user.role } : null;
}
