import { redirect } from "next/navigation";

import { BillingV2Shell } from "@/components/billing-v2/v2-shell";
import { canAny, homeFor } from "@/lib/auth/roles";
import { currentUser } from "@/lib/auth/session";
import { isLocalDemoRuntime } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export default async function BillingV3Layout({ children }: { children: React.ReactNode }) {
  if (!isLocalDemoRuntime) {
    const user = await currentUser();
    if (!user) redirect("/signin");
    if (!canAny(user.role, ["billing:read", "billing:price:write"])) redirect(homeFor(user.role));
  }
  return <BillingV2Shell basePath="/office-v3">{children}</BillingV2Shell>;
}
