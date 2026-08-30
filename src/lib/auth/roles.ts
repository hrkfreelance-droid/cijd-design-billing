export const ROLES = ["DESIGNER", "BILLING", "ACCOUNTING", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];

/**
 * What each role is allowed to do. Navigation is built from this, and so are
 * the server side checks — hiding a link is never the only thing stopping
 * someone from reaching data.
 */
export type Permission =
  | "production:read"
  | "production:write"
  | "delivery:write"
  | "client:write"
  | "billing:read"
  | "invoice:write"
  | "payment:read"
  | "payment:write"
  | "notification:manage";

const MATRIX: Record<Role, Permission[]> = {
  DESIGNER: ["production:read", "production:write", "delivery:write", "client:write"],
  BILLING: ["billing:read", "invoice:write", "notification:manage"],
  ACCOUNTING: ["payment:read", "payment:write"],
  ADMIN: [
    "production:read",
    "production:write",
    "delivery:write",
    "client:write",
    "billing:read",
    "invoice:write",
    "payment:read",
    "payment:write",
    "notification:manage",
  ],
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}

export function canAny(role: Role, permissions: Permission[]): boolean {
  return permissions.some((permission) => can(role, permission));
}

/** Where a role lands after signing in. */
export function homeFor(role: Role): string {
  if (can(role, "production:read")) return "/designer";
  if (can(role, "billing:read")) return "/office";
  return "/office/payments";
}

export function workspacesFor(role: Role): ("designer" | "office")[] {
  const spaces: ("designer" | "office")[] = [];
  if (can(role, "production:read")) spaces.push("designer");
  if (canAny(role, ["billing:read", "payment:read"])) spaces.push("office");
  return spaces;
}
