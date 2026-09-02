import { NextResponse } from "next/server";

import { ROLES, type Role } from "@/lib/auth/roles";
import { currentUser } from "@/lib/auth/session";
import { supabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function fail(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await currentUser();
  if (!actor || actor.role !== "ADMIN") return fail("FORBIDDEN", "Admin access is required.", 403);
  const admin = supabaseAdminClient();
  if (!admin) return fail("ADMIN_NOT_CONFIGURED", "Admin service is not configured.", 503);

  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail("BAD_REQUEST", "Invalid request.", 400);
  }

  const current = await admin.from("users").select("id, name, role, active").eq("id", id).single();
  if (current.error || !current.data) return fail("NOT_FOUND", "User not found.", 404);

  const patch: { name?: string; role?: Role; active?: boolean } = {};
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 120) return fail("INVALID_NAME", "Enter a name up to 120 characters.", 400);
    patch.name = name;
  }
  if (body.role !== undefined) {
    const role = typeof body.role === "string" ? body.role.toUpperCase() : "";
    if (!ROLES.includes(role as Role)) return fail("INVALID_ROLE", "Choose a valid role.", 400);
    patch.role = role as Role;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") return fail("INVALID_STATUS", "Invalid account status.", 400);
    patch.active = body.active;
  }

  const wouldDemoteAdmin = current.data.role === "ADMIN" && patch.role !== undefined && patch.role !== "ADMIN";
  const wouldDeactivateAdmin = current.data.role === "ADMIN" && patch.active === false;
  if (actor.id === id && (wouldDemoteAdmin || wouldDeactivateAdmin)) {
    return fail("SELF_ADMIN_LOCK", "You cannot remove your own Admin access.", 409);
  }

  if (wouldDemoteAdmin || wouldDeactivateAdmin) {
    const others = await admin
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("role", "ADMIN")
      .eq("active", true)
      .neq("id", id);
    if (others.error) return fail("ADMIN_CHECK_FAILED", "Could not verify Admin coverage.", 502);
    if ((others.count ?? 0) === 0) return fail("LAST_ADMIN", "At least one active Admin is required.", 409);
  }

  if (Object.keys(patch).length === 0) return fail("NO_CHANGES", "Nothing to update.", 400);

  const updated = await admin
    .from("users")
    .update(patch)
    .eq("id", id)
    .select("id, name, role, active, created_at")
    .single();
  if (updated.error || !updated.data) return fail("USER_UPDATE_FAILED", "Could not update the user.", 502);

  if (patch.name) {
    await admin.auth.admin.updateUserById(id, { user_metadata: { name: patch.name } });
  }

  const identity = await admin.auth.admin.getUserById(id);
  await admin.from("audit_logs").insert({
    actor: actor.name,
    action: "user.update",
    entity: "user",
    entity_id: id,
    detail: JSON.stringify(patch),
  });

  return NextResponse.json({
    ok: true,
    data: {
      id: updated.data.id,
      name: updated.data.name,
      email: identity.data.user?.email ?? "",
      role: updated.data.role,
      active: updated.data.active,
      createdAt: updated.data.created_at,
    },
  });
}
