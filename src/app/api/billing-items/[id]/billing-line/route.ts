import { NextResponse } from "next/server";

import { currentUser } from "@/lib/auth/session";
import { handle, num, readJson, str } from "@/lib/api";
import { RuleError } from "@/lib/data";
import { supabaseServerClient } from "@/lib/supabase/server";
import { toItem } from "@/lib/supabase/rows";
import type { BillingDiscountType, BillingItem } from "@/lib/types";

const ALLOWED = new Set(["BILLING", "ADMIN"]);
const DISCOUNT_TYPES = new Set<BillingDiscountType>(["NONE", "PERCENT", "AMOUNT"]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ ok: false, code: "UNAUTHENTICATED", message: "Sign in to continue." }, { status: 401 });
  }
  if (!ALLOWED.has(user.role)) {
    return NextResponse.json({ ok: false, code: "FORBIDDEN", message: "You do not have access to this." }, { status: 403 });
  }

  const { id } = await params;
  const body = await readJson(request);
  const originalName = str(body.originalName)?.trim() ?? "";
  const unitPrice = num(body.unitPrice);
  const quantity = num(body.quantity);
  const discountType = (str(body.discountType)?.trim().toUpperCase() || "NONE") as BillingDiscountType;
  const discountValue = num(body.discountValue) ?? 0;

  return handle(async () => {
    if (unitPrice == null || unitPrice < 0) throw new RuleError("INVALID", "Unit price must be zero or more.", 400);
    if (quantity == null || quantity <= 0) throw new RuleError("INVALID", "Quantity must be greater than zero.", 400);
    if (!DISCOUNT_TYPES.has(discountType)) throw new RuleError("INVALID", "Discount type is invalid.", 400);
    if (discountValue < 0 || (discountType === "PERCENT" && discountValue > 100)) {
      throw new RuleError("INVALID", "Discount is outside the allowed range.", 400);
    }

    const client = await supabaseServerClient();
    if (!client) throw new RuleError("OFFLINE", "Database is unavailable.", 503);
    const result = await client.rpc("set_billing_line_pricing", {
      p_item_id: id,
      p_original_name: originalName || null,
      p_unit_price: unitPrice,
      p_quantity: quantity,
      p_discount_type: discountType,
      p_discount_value: discountValue,
      p_actor: user.name,
    });
    if (result.error) {
      const code = result.error.message?.trim() || "INTERNAL";
      const status = code === "NOT_FOUND" ? 404 : code === "FORBIDDEN" ? 403 : code === "HISTORY_READ_ONLY" ? 403 : 409;
      throw new RuleError(code, result.error.details || result.error.message || code, status);
    }
    return toItem(result.data as Record<string, unknown>) as BillingItem;
  });
}
