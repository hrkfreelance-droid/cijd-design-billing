import { roundMoney } from "@/lib/format";

export const BILLING_DISCOUNT_TYPES = ["NONE", "PERCENT", "AMOUNT"] as const;
export type BillingDiscountType = (typeof BILLING_DISCOUNT_TYPES)[number];

export type BillingLineCalculation = {
  baseAmount: number;
  discountAmount: number;
  subtotal: number;
};

export function calculateBillingLine(
  quantity: number,
  unitPrice: number,
  discountType: BillingDiscountType = "NONE",
  discountValue = 0,
): BillingLineCalculation {
  const safeQuantity = Number.isFinite(quantity) ? Math.max(0, quantity) : 0;
  const safeUnit = Number.isFinite(unitPrice) ? Math.max(0, unitPrice) : 0;
  const safeDiscount = Number.isFinite(discountValue) ? Math.max(0, discountValue) : 0;
  const baseAmount = roundMoney(safeQuantity * safeUnit);
  let discountAmount = 0;
  if (discountType === "PERCENT") {
    discountAmount = roundMoney(baseAmount * Math.min(100, safeDiscount) / 100);
  } else if (discountType === "AMOUNT") {
    discountAmount = roundMoney(Math.min(baseAmount, safeDiscount));
  }
  return {
    baseAmount,
    discountAmount,
    subtotal: roundMoney(Math.max(0, baseAmount - discountAmount)),
  };
}

export function discountLabel(type: BillingDiscountType, value: number): string {
  if (type === "PERCENT") return `${value}%`;
  if (type === "AMOUNT") return `$${roundMoney(value).toFixed(2)}`;
  return "—";
}
