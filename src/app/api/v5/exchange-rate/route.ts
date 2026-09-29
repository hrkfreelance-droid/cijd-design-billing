import { handleV5 } from "@/lib/billing-v5/api";

export const dynamic = "force-dynamic";

/** Fetch today's NBC USD/KHR rate into V5's store (never into V3's). */
export async function POST() {
  return handleV5(["invoice:write", "payment:write"], (store) => store.refreshOfficialRate());
}
