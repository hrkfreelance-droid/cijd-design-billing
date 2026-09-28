import { redirect } from "next/navigation";
import { BillingV4Shell } from "@/components/billing-v4/v4-shell";
import { canAny, homeFor } from "@/lib/auth/roles";
import { currentUser } from "@/lib/auth/session";
import { isLocalDemoRuntime } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export default async function OfficeV4Layout({ children }: { children: React.ReactNode }) {
  if (!isLocalDemoRuntime) {
    const user = await currentUser();
    if (!user) redirect("/signin");
    if (!canAny(user.role, ["billing:read", "billing:price:write"])) redirect(homeFor(user.role));
  }
  return <BillingV4Shell>{children}</BillingV4Shell>;
}
