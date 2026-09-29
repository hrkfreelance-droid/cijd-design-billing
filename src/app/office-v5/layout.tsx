import { redirect } from "next/navigation";

import "@fontsource/noto-sans-khmer/400.css";
import "@fontsource/noto-sans-khmer/700.css";
import "@fontsource/moul/400.css";
import "@/components/billing-v5/tax-invoice.css";

import { BillingV3Shell } from "@/components/billing-v3/v3-shell";
import { canAny, homeFor } from "@/lib/auth/roles";
import { currentUser } from "@/lib/auth/session";
import { isV5Server } from "@/lib/billing-v5/runtime";
import { isLocalDemoRuntime } from "@/lib/runtime";

export const dynamic = "force-dynamic";

/**
 * Billing V5: the V3 screens, plus Accounting and the Tax Invoice, on V5's
 * own Worker and data.
 */
export default async function BillingV5Layout({ children }: { children: React.ReactNode }) {
  // V5 screens only run on the V5 Worker (its own D1). A build of this branch
  // anywhere else must never put them in front of V3's data.
  if (!isV5Server()) redirect("/office-v3");
  if (!isLocalDemoRuntime) {
    const user = await currentUser();
    if (!user) redirect("/signin");
    if (!canAny(user.role, ["billing:read", "billing:price:write", "payment:read"])) redirect(homeFor(user.role));
  }
  return (
    <>
      <span hidden data-cijd-build="v5-accounting" />
      <BillingV3Shell variant="v5">{children}</BillingV3Shell>
    </>
  );
}
