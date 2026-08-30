import { redirect } from "next/navigation";

import { OFFICE_NAV, Workspace } from "@/components/shell";
import { canAny, homeFor } from "@/lib/auth/roles";
import { currentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function OfficeLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== "1") {
    const user = await currentUser();
    if (!user) redirect("/signin");
    if (!canAny(user.role, ["billing:read", "payment:read"])) redirect(homeFor(user.role));
  }
  return (
    <Workspace nav={OFFICE_NAV} workspace="office" requires={["billing:read", "payment:read"]}>
      {children}
    </Workspace>
  );
}
