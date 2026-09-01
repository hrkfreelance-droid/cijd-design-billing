export const ROLES = ["DESIGNER", "BILLING", "ACCOUNTING", "PRINTING", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];

/**
 * What each role is allowed to do. Navigation is built from this, and so are
 * the server side checks — hiding a link is never the only thing stopping
 * someone from reaching data.
 */
export type Permission =
  | "designer:read"
  | "production:read"
  | "progress:read"
  | "production:write"
  | "delivery:write"
  | "client:write"
  | "billing:read"
  | "invoice:write"
  | "payment:read"
  | "payment:write"
  | "printing:read"
  | "print:write";

const MATRIX: Record<Role, Permission[]> = {
  // Hiroki owns the full handoff in this workspace: Design → Printing →
  // Billing → Accounting. The UI still keeps each workspace focused, while
  // the Designer account can move downstream work forward or undo it.
  DESIGNER: [
    "designer:read",
    "production:read",
    "progress:read",
    "production:write",
    "delivery:write",
    "client:write",
    "printing:read",
    "print:write",
    "billing:read",
    "invoice:write",
    "payment:read",
    "payment:write",
  ],
  // Billing hands the user directly to the Accounting view after invoicing;
  // it can read that queue but payment confirmation remains Accounting-only.
  BILLING: ["billing:read", "invoice:write", "payment:read", "progress:read"],
  ACCOUNTING: ["payment:read", "payment:write", "progress:read"],
  PRINTING: ["production:read", "printing:read", "print:write", "delivery:write"],
  ADMIN: [
    "production:read",
    "progress:read",
    "designer:read",
    "production:write",
    "delivery:write",
    "client:write",
    "billing:read",
    "invoice:write",
    "payment:read",
    "payment:write",
    "printing:read",
    "print:write",
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
  if (can(role, "printing:read") && !can(role, "designer:read")) return "/printing";
  if (can(role, "designer:read")) return "/designer/projects";
  if (can(role, "billing:read")) return "/office";
  return "/office/payments";
}

export function workspacesFor(role: Role): ("designer" | "printing" | "office")[] {
  const spaces: ("designer" | "printing" | "office")[] = [];
  if (can(role, "designer:read")) spaces.push("designer");
  if (can(role, "printing:read")) spaces.push("printing");
  if (canAny(role, ["billing:read", "payment:read", "progress:read"])) spaces.push("office");
  return spaces;
}
