import { redirect } from "next/navigation";

import { OfficeExchangeRateStrip } from "@/components/office-exchange-rate-strip";
import { OFFICE_NAV, Workspace } from "@/components/shell";
import { canAny, homeFor } from "@/lib/auth/roles";
import { currentUser } from "@/lib/auth/session";
import { isLocalDemoRuntime } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export default async function OfficeLayout({ children }: { children: React.ReactNode }) {
  if (!isLocalDemoRuntime) {
    const user = await currentUser();
    if (!user) redirect("/signin?next=%2Foffice");
    if (!canAny(user.role, ["billing:read", "payment:read", "progress:read"])) redirect(homeFor(user.role));
  }
  return (
    <Workspace
      nav={OFFICE_NAV}
      workspace="office"
      requires={["billing:read", "payment:read", "progress:read"]}
    >
      <OfficeExchangeRateStrip />
      {children}
    </Workspace>
  );
}
