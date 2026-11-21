import { readJson } from "@/lib/api";
import { handleV5 } from "@/lib/billing-v5/api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await readJson(request);
  return handleV5(["billing:price:write"], (store, user) => store.saveServiceFormat(body, user.name));
}
