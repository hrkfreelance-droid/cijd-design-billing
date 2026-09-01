import { NextResponse } from "next/server";

import { readJson, str } from "@/lib/api";
import { clearAccessSession, currentAccessUser } from "@/lib/auth/access-links";
import { SESSION_COOKIE, currentUser } from "@/lib/auth/session";
import { getLocalRepository } from "@/lib/data";
import { dataMode } from "@/lib/supabase/config";
import { isLocalDemoRuntime } from "@/lib/runtime";
import { supabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function unavailable() {
  return NextResponse.json(
    {
      ok: false,
      code: "PRODUCTION_DATA_NOT_CONFIGURED",
      message: "Supabase credentials are required in production.",
    },
    { status: 503 },
  );
}

function previewUnavailable() {
  return NextResponse.json(
    { ok: false, code: "DEMO_MODE", message: "This preview runs on browser-local demo data." },
    { status: 404 },
  );
}

function configuredMode() {
  try {
    return dataMode();
  } catch {
    return null;
  }
}

/**
 * With Supabase configured, this route reports either the signed-in Supabase
 * user or the active server-verified Access Link session. Without it, the
 * development stand-in lets you pick a person from the local store.
 */
export async function GET() {
  if (isLocalDemoRuntime) return previewUnavailable();
  const mode = configuredMode();
  if (!mode) return unavailable();
  const accessUser = await currentAccessUser();
  const user = await currentUser();
  if (mode === "supabase") {
    const client = await supabaseServerClient();
    const identity = client ? (await client.auth.getUser()).data.user : null;
    return NextResponse.json({
      ok: true,
      data: {
        user,
        users: [],
        auth: "supabase",
        access: accessUser ? "active" : identity ? (user ? "active" : "denied") : "signed_out",
      },
    });
  }
  const users = await getLocalRepository().rawUsers();
  return NextResponse.json({
    ok: true,
    data: {
      user,
      users: users.map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        role: candidate.role,
      })),
      auth: "local",
      access: user ? "active" : "signed_out",
    },
  });
}

export async function POST(request: Request) {
  if (isLocalDemoRuntime) return previewUnavailable();
  const mode = configuredMode();
  if (!mode) return unavailable();
  if (mode === "supabase") {
    return NextResponse.json(
      { ok: false, code: "USE_SUPABASE", message: "Sign in with Supabase Auth." },
      { status: 400 },
    );
  }
  const body = await readJson(request);
  const id = str(body.userId) ?? "";
  const users = await getLocalRepository().rawUsers();
  const user = users.find((candidate) => candidate.id === id);
  if (!user) {
    return NextResponse.json(
      { ok: false, code: "NOT_FOUND", message: "Unknown user." },
      { status: 404 },
    );
  }
  const response = NextResponse.json({
    ok: true,
    data: { id: user.id, name: user.name, role: user.role },
  });
  response.cookies.set(SESSION_COOKIE, user.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}

export async function DELETE() {
  if (isLocalDemoRuntime) return previewUnavailable();
  const response = NextResponse.json({ ok: true, data: null });
  response.cookies.delete(SESSION_COOKIE);
  clearAccessSession(response);
  return response;
}
