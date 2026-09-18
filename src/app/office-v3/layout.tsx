import { redirect } from "next/navigation";

import { BillingV3Shell } from "@/components/billing-v3/v3-shell";
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
  return (
    <>
      <span hidden data-cijd-v3-build="qty-unit-derived-total" />
      <BillingV3Shell>{children}</BillingV3Shell>
    </>
  );
}
