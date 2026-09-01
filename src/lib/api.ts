import { NextResponse } from "next/server";

import { GuardedRepository } from "@/lib/auth/guarded-repository";
import { currentUser, type SessionUser } from "@/lib/auth/session";
import { getRepository, RuleError } from "@/lib/data";
import { isDemoMode, isPreviewRuntime } from "@/lib/runtime";

/**
 * Wraps a handler so rule violations come back as a readable message.
 *
 * On the public preview the store lives in the visitor's browser, so these
 * routes are switched off rather than left open as writable endpoints.
 */
export async function handle<T>(fn: () => Promise<T>): Promise<NextResponse> {
  if (isDemoMode || isPreviewRuntime) {
    return NextResponse.json(
      { ok: false, code: "DEMO_MODE", message: "This preview runs on browser-local demo data." },
      { status: 404 },
    );
  }
  try {
    return NextResponse.json({ ok: true, data: await fn() });
  } catch (error) {
    if (error instanceof RuleError) {
      return NextResponse.json(
        { ok: false, code: error.code, message: error.message },
        { status: error.status },
      );
    }
    const message = error instanceof Error ? error.message : "Unexpected error";
    console.error("[api]", error);
    return NextResponse.json({ ok: false, code: "INTERNAL", message }, { status: 500 });
  }
}

/**
 * Every data route runs through here: the signed-in role decides both what can
 * be changed and what comes back, so a direct call cannot bypass the UI.
 */
export async function handleAs<T>(
  fn: (repo: GuardedRepository, user: SessionUser) => Promise<T>,
): Promise<NextResponse> {
  if (isDemoMode || isPreviewRuntime) return handle(async () => null as T);
  const user = await currentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHENTICATED", message: "Sign in to continue." },
      { status: 401 },
    );
  }
  const repo = await getRepository();
  return handle(() => fn(new GuardedRepository(repo, user), user));
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return (body ?? {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}
