import { redirect } from "next/navigation";

import { currentUser } from "@/lib/auth/session";
import { homeFor } from "@/lib/auth/roles";
import { isLocalDemoRuntime } from "@/lib/runtime";

export const dynamic = "force-dynamic";

/** Each role starts in its own workspace; public demo enters Design directly. */
export default async function Home() {
  if (isLocalDemoRuntime) redirect("/designer/projects");
  const user = await currentUser();
  redirect(user ? homeFor(user.role) : "/signin");
}
