import { redirect } from "next/navigation";

import "@fontsource/noto-sans-khmer/400.css";
import "@fontsource/noto-sans-khmer/700.css";
import "@fontsource/moul/400.css";
import "@/components/billing-v5/tax-invoice.css";

import "@/components/billing-v5/workspace.css";
import { BillingWorkspace } from "@/components/billing-v5/workspace-shell";
import { canAny, homeFor } from "@/lib/auth/roles";
import { currentUser } from "@/lib/auth/session";
import { isV5Server } from "@/lib/billing-v5/runtime";
import { isLocalDemoRuntime } from "@/lib/runtime";

export const dynamic = "force-dynamic";

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
      <BillingWorkspace>{children}</BillingWorkspace>
    </>
  );
}
