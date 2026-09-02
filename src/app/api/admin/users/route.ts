import { NextResponse } from "next/server";

import { passwordPolicyProblem } from "@/lib/auth/password";
import { ROLES, type Role } from "@/lib/auth/roles";
import { currentUser } from "@/lib/auth/session";
import { supabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function adminContext() {
  const actor = await currentUser();
  if (!actor || actor.role !== "ADMIN") return null;
  const admin = supabaseAdminClient();
  return admin ? { actor, admin } : null;
}

function fail(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}

export async function GET() {
  const context = await adminContext();
  if (!context) return fail("FORBIDDEN", "Admin access is required.", 403);

  const { admin } = context;
  const [profiles, identities] = await Promise.all([
    admin.from("users").select("id, name, role, active, created_at").order("created_at", { ascending: true }),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  if (profiles.error || identities.error) {
    return fail("ADMIN_USERS_READ_FAILED", "Could not load users.", 502);
  }

  const emailById = new Map(identities.data.users.map((user) => [user.id, user.email ?? ""]));
  const data = (profiles.data ?? []).map((profile) => ({
    id: profile.id,
    name: profile.name,
    email: emailById.get(profile.id) ?? "",
    role: profile.role,
    active: profile.active,
    createdAt: profile.created_at,
  }));

  return NextResponse.json({ ok: true, data });
}

export async function POST(request: Request) {
  const context = await adminContext();
  if (!context) return fail("FORBIDDEN", "Admin access is required.", 403);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail("BAD_REQUEST", "Invalid request.", 400);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const role = typeof body.role === "string" ? body.role.toUpperCase() : "";

  if (!EMAIL_RE.test(email)) return fail("INVALID_EMAIL", "Enter a valid email address.", 400);
  if (!name || name.length > 120) return fail("INVALID_NAME", "Enter a name up to 120 characters.", 400);
  const passwordProblem = passwordPolicyProblem(password);
  if (passwordProblem) return fail("INVALID_PASSWORD", passwordProblem, 400);
  if (!ROLES.includes(role as Role)) return fail("INVALID_ROLE", "Choose a valid role.", 400);

  const { actor, admin } = context;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });

  if (created.error || !created.data.user) {
    const duplicate = /already|registered|exists/i.test(created.error?.message ?? "");
    return fail(
      duplicate ? "EMAIL_EXISTS" : "AUTH_USER_CREATE_FAILED",
      duplicate ? "That email is already registered." : "Could not create the account.",
      duplicate ? 409 : 502,
    );
  }

  const userId = created.data.user.id;
  const profile = await admin
    .from("users")
    .update({ name, role, active: true })
    .eq("id", userId)
    .select("id, name, role, active, created_at")
    .single();

  if (profile.error || !profile.data) {
    await admin.auth.admin.deleteUser(userId);
    return fail("PROFILE_CREATE_FAILED", "The account could not be completed. No login was kept.", 502);
  }

  await admin.from("audit_logs").insert({
    actor: actor.name,
    action: "user.create",
    entity: "user",
    entity_id: userId,
    detail: `${role}: ${name}`,
  });

  return NextResponse.json(
    {
      ok: true,
      data: {
        id: profile.data.id,
        name: profile.data.name,
        email,
        role: profile.data.role,
        active: profile.data.active,
        createdAt: profile.data.created_at,
      },
    },
    { status: 201 },
  );
}
