import { redirect } from "next/navigation";

import { PRINTING_NAV, Workspace } from "@/components/shell";
import { can, homeFor } from "@/lib/auth/roles";
import { currentUser } from "@/lib/auth/session";
import { isLocalDemoRuntime } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export default async function PrintingLayout({ children }: { children: React.ReactNode }) {
  if (!isLocalDemoRuntime) {
    const user = await currentUser();
    if (!user) redirect("/signin");
    if (!can(user.role, "printing:read")) redirect(homeFor(user.role));
  }
  return (
    <Workspace nav={PRINTING_NAV} workspace="printing" requires={["printing:read"]}>
      {children}
    </Workspace>
  );
}
