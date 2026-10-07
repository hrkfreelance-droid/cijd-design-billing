import type { InvoiceInput } from "./invoicing";
/* ------------------------------------------------------------ body parsing */


const text = (value: unknown) => (typeof value === "string" ? value : undefined);
const number = (value: unknown) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return parsed;
};

/** A JSON body → invoice input. Numbers stay NaN when missing so the rules reject them. */
export function invoiceInputFrom(body: Record<string, unknown>, actor: string): InvoiceInput {
  const customer = (body.customer ?? {}) as Record<string, unknown>;
  const rate = body.exchangeRate as Record<string, unknown> | null | undefined;
  const discount = body.discount as Record<string, unknown> | null | undefined;
  return {
    invoiceType: body.invoiceType === "INVOICE" ? "INVOICE" : "TAX_INVOICE",
    customerId: text(body.customerId) ?? "",
    invoiceDate: text(body.invoiceDate) ?? "",
    customer: {
      companyNameEn: text(customer.companyNameEn),
      companyNameKm: text(customer.companyNameKm),
      addressEn: text(customer.addressEn),
      addressKm: text(customer.addressKm),
      telephone: text(customer.telephone),
      vatin: text(customer.vatin),
    },
    items: Array.isArray(body.items)
      ? (body.items as Record<string, unknown>[]).map((item) => ({
          billingItemId: text(item.billingItemId) ?? null,
          productId: text(item.productId) ?? null,
          description: text(item.description) ?? "",
          quantity: number(item.quantity),
          unit: text(item.unit) ?? null,
          unitPrice: number(item.unitPrice),
          amount: item.amount === undefined || item.amount === null ? undefined : number(item.amount),
        }))
      : [],
    discount:
      discount && (discount.type === "FIXED" || discount.type === "PERCENT")
        ? { type: discount.type, value: number(discount.value) }
        : null,
    vatApplicable: body.vatApplicable !== false,
    exchangeRate: rate
      ? { rate: number(rate.rate), source: rate.source === "MANUAL" ? "MANUAL" : "NBC", effectiveDate: text(rate.effectiveDate) ?? null }
      : null,
    depositUsd: body.depositUsd === undefined || body.depositUsd === null || body.depositUsd === "" ? 0 : number(body.depositUsd),
    note: text(body.note) ?? null,
    updateCustomerMaster: body.updateCustomerMaster === true ? true : body.updateCustomerMaster === false ? false : undefined,
    invoiceNumber: text(body.invoiceNumber),
    reason: text(body.reason) ?? null,
    actor,
  };
}
