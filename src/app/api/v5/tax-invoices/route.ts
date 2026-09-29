import { num, readJson, str } from "@/lib/api";
import { handleV5 } from "@/lib/billing-v5/api";

export const dynamic = "force-dynamic";

/** Issue a Tax Invoice for one invoice-ready project. */
export async function POST(request: Request) {
  const body = await readJson(request);
  const customer = (body.customer ?? {}) as Record<string, unknown>;
  return handleV5(["invoice:write", "payment:write"], (store, user) =>
    store.issueTaxInvoice({
      projectId: str(body.projectId) ?? "",
      invoiceNumber: str(body.invoiceNumber) ?? "",
      invoiceDate: str(body.invoiceDate) ?? "",
      customer: {
        companyNameEn: str(customer.companyNameEn),
        companyNameKm: str(customer.companyNameKm),
        addressEn: str(customer.addressEn),
        addressKm: str(customer.addressKm),
        telephone: str(customer.telephone),
        vatin: str(customer.vatin),
      },
      exchangeRate: num(body.exchangeRate) ?? Number.NaN,
      exchangeRateSource: body.exchangeRateSource === "NBC" ? "NBC" : "MANUAL",
      exchangeRateEffectiveDate: str(body.exchangeRateEffectiveDate) ?? null,
      vatApplicable: body.vatApplicable !== false,
      actor: user.name,
    }),
  );
}
