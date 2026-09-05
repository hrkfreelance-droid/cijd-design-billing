import { redirect } from "next/navigation";

import { AdminWorkspace } from "@/components/admin-workspace";
import { homeFor } from "@/lib/auth/roles";
import { currentUser } from "@/lib/auth/session";
import { isLocalDemoRuntime } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  if (isLocalDemoRuntime) redirect("/designer/projects");
  const user = await currentUser();
  if (!user) redirect("/signin");
  if (user.role !== "ADMIN") redirect(homeFor(user.role));
  return <AdminWorkspace />;
}
