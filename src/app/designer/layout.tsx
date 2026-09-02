import { redirect } from "next/navigation";

import { DESIGNER_NAV, Workspace } from "@/components/shell";
import { can, homeFor } from "@/lib/auth/roles";
import { currentUser } from "@/lib/auth/session";
import { isLocalDemoRuntime } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export default async function DesignerLayout({ children }: { children: React.ReactNode }) {
  if (!isLocalDemoRuntime) {
    const user = await currentUser();
    if (!user) redirect("/signin?next=%2Fdesigner%2Fprojects");
    if (!can(user.role, "designer:read")) redirect(homeFor(user.role));
  }
  return (
    <Workspace nav={DESIGNER_NAV} workspace="designer" requires={["designer:read"]}>
      {children}
    </Workspace>
  );
}
