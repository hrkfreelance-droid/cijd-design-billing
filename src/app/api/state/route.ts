import { handleAs } from "@/lib/api";

import { can, canAny } from "@/lib/auth/roles";
import { readLegacyProjects } from "@/lib/billing-v5/repository";
import { isV5Server } from "@/lib/billing-v5/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  return handleAs(async (repo) => {
    const snapshot = await repo.getSnapshot();
    if (isV5Server() && canAny(repo.role, ["billing:read", "payment:read"])) {
      const canReadPayments = can(repo.role, "payment:read");
      snapshot.legacyProjects = (await readLegacyProjects()).map((entry) =>
        canReadPayments ? entry : { ...entry, payments: [] },
      );
    }
    return snapshot;
  });
}
