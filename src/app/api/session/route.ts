import { NextResponse } from "next/server";

import { readJson, str } from "@/lib/api";
import { SESSION_COOKIE, currentUser } from "@/lib/auth/session";
import { getLocalRepository } from "@/lib/data";
import { dataMode } from "@/lib/supabase/config";

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

function configuredMode() {
  try {
    return dataMode();
  } catch {
    return null;
  }
}

/**
 * With Supabase configured, signing in happens through Supabase Auth and this
 * route only reports who is signed in. Without it, the development stand-in
 * lets you pick a person: the cookie names a user and the role is always read
 * from the store, so it cannot be forged into extra permissions.
 */
export async function GET() {
  const mode = configuredMode();
  if (!mode) return unavailable();
  const user = await currentUser();
  if (mode === "supabase") {
    return NextResponse.json({ ok: true, data: { user, users: [], auth: "supabase" } });
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
    },
  });
}

export async function POST(request: Request) {
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
  const response = NextResponse.json({ ok: true, data: null });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
