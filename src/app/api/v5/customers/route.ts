import { readJson } from "@/lib/api";
import { handleV5 } from "@/lib/billing-v5/api";
import type { CustomerInput } from "@/lib/billing-v5/invoicing";
import { normalizedTin } from "@/lib/billing-v5/patent-import";
import { RuleError } from "@/lib/data/repository";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await readJson(request);
  const { id: _ignored, ...fields } = body;
  void _ignored;
  return handleV5(["invoice:write", "payment:write"], async (store, user) => {
    const requestedTin = normalizedTin(typeof fields.vatin === "string" ? fields.vatin : "");
    if (requestedTin) {
      const snapshot = await store.getSnapshot();
      if ((snapshot.customers ?? []).some((customer) => normalizedTin(customer.vatin) === requestedTin)) {
        throw new RuleError("DUPLICATE_TIN", "Customer with this Tax ID already exists.", 409);
      }
    }
    return store.saveCustomer({ ...(fields as Partial<CustomerInput>), actor: user.name });
  });
}
