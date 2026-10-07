import { NextResponse } from "next/server";

import { handle } from "@/lib/api";
import { canAny, type Permission } from "@/lib/auth/roles";
import { currentUser, type SessionUser } from "@/lib/auth/session";
import type { Store } from "@/lib/data/store";
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

export { invoiceInputFrom } from "./invoice-input";
