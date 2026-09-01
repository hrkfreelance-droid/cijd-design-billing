import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

import type { Role } from "./roles";

export const ACCESS_SESSION_COOKIE = "cijd.access_session";
export const ACCESS_SESSION_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * A token "kind" is either one of the five real Roles, or the extra `PILOT`
 * kind: a single reusable link for the pilot period that carries full
 * (ADMIN-equivalent) access without being the real Admin credential. Kinds
 * are an internal detail of this module — everywhere else in the app still
 * only ever sees a `Role`, via `ROLE_FOR_KIND` below.
 */
type TokenKind = Role | "PILOT";

const ACCESS_TOKEN_ENV: Record<TokenKind, string> = {
  ADMIN: "CIJD_ADMIN_ACCESS_TOKEN",
  DESIGNER: "CIJD_DESIGNER_ACCESS_TOKEN",
  PRINTING: "CIJD_PRINTING_ACCESS_TOKEN",
  BILLING: "CIJD_BILLING_ACCESS_TOKEN",
  ACCOUNTING: "CIJD_ACCOUNTING_ACCESS_TOKEN",
  PILOT: "CIJD_PILOT_ACCESS_TOKEN",
};

const ACCESS_NAMES: Record<TokenKind, string> = {
  ADMIN: "Admin",
  DESIGNER: "Hiroki",
  PRINTING: "Printing",
  BILLING: "Billing",
  ACCOUNTING: "Accounting",
  PILOT: "Pilot Full Access",
};

/** Every kind resolves to a real Role for permissions/navigation; PILOT maps to ADMIN. */
const ROLE_FOR_KIND: Record<TokenKind, Role> = {
  ADMIN: "ADMIN",
  DESIGNER: "DESIGNER",
  PRINTING: "PRINTING",
  BILLING: "BILLING",
  ACCOUNTING: "ACCOUNTING",
  PILOT: "ADMIN",
};

const TOKEN_KINDS = Object.keys(ACCESS_TOKEN_ENV) as TokenKind[];
const encoder = new TextEncoder();

export interface AccessIdentity {
  id: string;
  name: string;
  role: Role;
}

interface VerifiedAccess extends AccessIdentity {
  secret: string;
  kind: TokenKind;
}

/** Access links are an explicit operational switch and can later be turned off. */
export function accessLinksEnabled(): boolean {
  return process.env.CIJD_ACCESS_LINKS_ENABLED === "1";
}

function secretFor(kind: TokenKind): string | null {
  const value = process.env[ACCESS_TOKEN_ENV[kind]]?.trim();
  return value && value.length >= 32 ? value : null;
}

function identityFor(kind: TokenKind): AccessIdentity {
  return { id: `access:${kind.toLowerCase()}`, name: ACCESS_NAMES[kind], role: ROLE_FOR_KIND[kind] };
}

function encoded(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decoded(value: string): Uint8Array | null {
  try {
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function sign(secret: string, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

async function same(value: string, expected: string): Promise<boolean> {
  const [actualHash, expectedHash] = await Promise.all([digest(value), digest(expected)]);
  if (actualHash.length !== expectedHash.length) return false;
  let difference = 0;
  for (let index = 0; index < actualHash.length; index += 1) {
    difference |= actualHash[index] ^ expectedHash[index];
  }
  return difference === 0;
}

/** Returns the fixed identity only when the complete secret matches. */
async function verifyAccessToken(token: string): Promise<VerifiedAccess | null> {
  if (!accessLinksEnabled() || !token) return null;
  for (const kind of TOKEN_KINDS) {
    const secret = secretFor(kind);
    if (!secret || !(await same(token, secret))) continue;
    return { ...identityFor(kind), secret, kind };
  }
  return null;
}

export async function identityForAccessToken(token: string): Promise<AccessIdentity | null> {
  const verified = await verifyAccessToken(token);
  if (!verified) return null;
  return { id: verified.id, name: verified.name, role: verified.role };
}

async function sessionValue(kind: TokenKind, secret: string): Promise<string> {
  const payload = `${kind}.${Date.now()}`;
  return `${encoded(encoder.encode(payload))}.${encoded(await sign(secret, payload))}`;
}

async function verifySession(value: string): Promise<AccessIdentity | null> {
  if (!accessLinksEnabled()) return null;
  const [payloadPart, signaturePart] = value.split(".");
  if (!payloadPart || !signaturePart) return null;
  const payloadBytes = decoded(payloadPart);
  const signature = decoded(signaturePart);
  if (!payloadBytes || !signature) return null;
  const payload = new TextDecoder().decode(payloadBytes);
  const [kind, issuedAt] = payload.split(".") as [TokenKind | undefined, string | undefined];
  if (!kind || !TOKEN_KINDS.includes(kind) || !issuedAt) return null;
  const timestamp = Number(issuedAt);
  if (!Number.isFinite(timestamp) || Date.now() - timestamp > ACCESS_SESSION_MAX_AGE * 1000) {
    return null;
  }
  if (timestamp > Date.now() + 60_000) return null;
  const secret = secretFor(kind);
  if (!secret) return null;
  const expected = await sign(secret, payload);
  if (expected.length !== signature.length) return null;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected[index] ^ signature[index];
  }
  return difference === 0 ? identityFor(kind) : null;
}

/** Reads the signed Role session; the cookie never contains the original URL token. */
export async function currentAccessUser(): Promise<AccessIdentity | null> {
  const value = (await cookies()).get(ACCESS_SESSION_COOKIE)?.value;
  return value ? verifySession(value) : null;
}

export async function setAccessSession(
  response: NextResponse,
  verified: VerifiedAccess,
  secure: boolean,
): Promise<void> {
  response.cookies.set(ACCESS_SESSION_COOKIE, await sessionValue(verified.kind, verified.secret), {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: ACCESS_SESSION_MAX_AGE,
  });
}

export function clearAccessSession(response: NextResponse): void {
  response.cookies.set(ACCESS_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function verifyAccessLink(token: string): Promise<VerifiedAccess | null> {
  return verifyAccessToken(token);
}
