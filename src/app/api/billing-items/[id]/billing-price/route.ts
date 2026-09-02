import { NextResponse } from "next/server";

import { currentUser } from "@/lib/auth/session";
import { handle, num, readJson } from "@/lib/api";
import { RuleError } from "@/lib/data";
import { supabaseServerClient } from "@/lib/supabase/server";
import { toItem } from "@/lib/supabase/rows";
import type { BillingItem } from "@/lib/types";

const ALLOWED = new Set(["DESIGNER", "BILLING", "ADMIN"]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHENTICATED", message: "Sign in to continue." },
      { status: 401 },
    );
  }
  if (!ALLOWED.has(user.role)) {
    return NextResponse.json(
      { ok: false, code: "FORBIDDEN", message: "You do not have access to this." },
      { status: 403 },
    );
  }

  const { id } = await params;
  const body = await readJson(request);
  const amount = num(body.amount);

  return handle(async () => {
    if (!amount || amount <= 0) {
      throw new RuleError("INVALID", "Billing price must be greater than zero.", 400);
    }
    const client = await supabaseServerClient();
    if (!client) throw new RuleError("OFFLINE", "Database is unavailable.", 503);

    const result = await client.rpc("set_billing_price", {
      p_item_id: id,
      p_amount: amount,
      p_actor: user.name,
    });
    if (result.error) {
      const code = result.error.message?.trim() || "INTERNAL";
      const status = code === "NOT_FOUND" ? 404 : code === "FORBIDDEN" ? 403 : 409;
      throw new RuleError(code, result.error.details || result.error.message || code, status);
    }
    return toItem(result.data as Record<string, unknown>) as BillingItem;
  });
}