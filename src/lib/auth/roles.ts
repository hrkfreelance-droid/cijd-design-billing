export const ROLES = ["DESIGNER", "BILLING", "ACCOUNTING", "PRINTING", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];

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

/**
 * Billing is a back-office hub, not a peer production service.
 * Design / Printing cannot see Billing. Billing can read operational progress,
 * while Admin is the only role that crosses every workspace and manages clients.
 */
const MATRIX: Record<Role, Permission[]> = {
  DESIGNER: [
    "designer:read",
    "production:read",
    "production:write",
    "delivery:write",
  ],
  PRINTING: [
    "production:read",
    "printing:read",
    "print:write",
    "delivery:write",
  ],
  BILLING: [
    "progress:read",
    "billing:read",
    "invoice:write",
    "payment:read",
  ],
  ACCOUNTING: [
    "payment:read",
    "payment:write",
  ],
  ADMIN: [
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
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}

export function canAny(role: Role, permissions: Permission[]): boolean {
  return permissions.some((permission) => can(role, permission));
}

export function homeFor(role: Role): string {
  if (role === "ADMIN") return "/designer/projects";
  if (role === "DESIGNER") return "/designer/projects";
  if (role === "PRINTING") return "/printing";
  if (role === "BILLING") return "/office";
  return "/office/payments";
}

export function workspacesFor(role: Role): ("designer" | "printing" | "office")[] {
  if (role === "ADMIN") return ["designer", "printing", "office"];
  if (role === "DESIGNER") return ["designer"];
  if (role === "PRINTING") return ["printing"];
  return ["office"];
}
