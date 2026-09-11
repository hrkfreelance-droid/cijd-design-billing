import { redirect } from "next/navigation";

import { currentUser } from "@/lib/auth/session";
import { can, homeFor } from "@/lib/auth/roles";
import { isLocalDemoRuntime } from "@/lib/runtime";

export const dynamic = "force-dynamic";

/**
 * Billing V2 is the way in.
 *
 * Anyone who bills lands on the single Billing screen rather than having to
 * find it. The original workspaces are untouched and still reachable by their
 * own URLs; only the default destination moved.
 */
export default async function Home() {
  if (isLocalDemoRuntime) redirect("/signin");
  const user = await currentUser();
  if (!user) redirect("/signin");
  if (can(user.role, "billing:price:write")) redirect("/office-v2");
  redirect(homeFor(user.role));
}
