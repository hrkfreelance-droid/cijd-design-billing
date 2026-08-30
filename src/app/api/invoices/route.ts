import { handleAs, readJson, str } from "@/lib/api";

export async function POST(request: Request) {
  const body = await readJson(request);
  const ids = Array.isArray(body.billingItemIds)
    ? body.billingItemIds.filter((value): value is string => typeof value === "string")
    : [];
  return handleAs((repo) =>
    repo.createInvoice({
      clientId: str(body.clientId) ?? "",
      invoiceNumber: str(body.invoiceNumber) ?? "",
      invoiceDate: str(body.invoiceDate) ?? "",
      billingItemIds: ids,
    }),
  );
}
