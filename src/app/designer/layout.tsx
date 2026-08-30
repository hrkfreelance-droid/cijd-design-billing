import { redirect } from "next/navigation";

import { DESIGNER_NAV, Workspace } from "@/components/shell";
import { can, homeFor } from "@/lib/auth/roles";
import { currentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** Typing the URL is not a way in: the check runs on the server. */
export default async function DesignerLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== "1") {
    const user = await currentUser();
    if (!user) redirect("/signin");
    if (!can(user.role, "production:read")) redirect(homeFor(user.role));
  }
  return (
    <Workspace nav={DESIGNER_NAV} workspace="designer" requires={["production:read"]}>
      {children}
    </Workspace>
  );
}
