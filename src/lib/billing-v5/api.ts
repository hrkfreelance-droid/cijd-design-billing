import { NextResponse } from "next/server";

import { handle } from "@/lib/api";
import { canAny, type Permission } from "@/lib/auth/roles";
import { currentUser, type SessionUser } from "@/lib/auth/session";
import type { Store } from "@/lib/data/store";
import type { InvoiceInput } from "./invoicing";
import { getV5Repository } from "./repository";
import { isV5Server } from "./runtime";

/**
 * V5's own operations (Tax Invoice, payments, NBC rate). They exist only on
 * the V5 Worker and only ever touch V5's D1 store.
 */
export async function handleV5<T>(
  permissions: Permission[],
  fn: (store: Store, user: SessionUser) => Promise<T>,
): Promise<NextResponse> {
  if (!isV5Server()) {
    return NextResponse.json({ ok: false, code: "NOT_FOUND", message: "Not found." }, { status: 404 });
  }
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ ok: false, code: "UNAUTHENTICATED", message: "Sign in to continue." }, { status: 401 });
  }
  if (!canAny(user.role, permissions)) {
    return NextResponse.json({ ok: false, code: "FORBIDDEN", message: "You do not have access to this." }, { status: 403 });
  }
  return handle(() => fn(getV5Repository(), user));
}

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
