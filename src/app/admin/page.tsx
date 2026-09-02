import { redirect } from "next/navigation";

import { AdminWorkspace } from "@/components/admin-workspace";
import { homeFor } from "@/lib/auth/roles";
import { currentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await currentUser();
  if (!user) redirect("/signin");
  if (user.role !== "ADMIN") redirect(homeFor(user.role));
  return <AdminWorkspace />;
}
