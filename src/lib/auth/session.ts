import { cookies } from "next/headers";

import { getLocalRepository } from "@/lib/data";
import { dataMode } from "@/lib/supabase/config";
import { supabaseServerClient } from "@/lib/supabase/server";
import type { Role } from "./roles";

export const SESSION_COOKIE = "cijd.session";

export interface SessionUser {
  id: string;
  name: string;
  role: Role;
}

/**
 * With Supabase configured this is a real authenticated session. Without it,
 * a development stand-in: the cookie only names a user and the role is always
 * read back from the store, so a tampered cookie cannot grant permissions.
 */
export async function currentUser(): Promise<SessionUser | null> {
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
