export interface V4AuthEnvironment {
  V4_ACCESS_TOKEN?: string;
  V4_SESSION_SECRET?: string;
}

export const V4_SESSION_COOKIE = "cijd_v4_preview";
const encoder = new TextEncoder();

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return hex(new Uint8Array(digest));
}

function constantTimeEqual(left: string, right: string): boolean {
  const max = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < max; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function configured(env: V4AuthEnvironment): env is Required<V4AuthEnvironment> {
  return Boolean(env.V4_ACCESS_TOKEN?.trim() && env.V4_SESSION_SECRET?.trim());
}

function readCookie(request: Request): string {
  const cookies = request.headers.get("cookie") ?? "";
  const pair = cookies.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${V4_SESSION_COOKIE}=`));
  return pair?.slice(V4_SESSION_COOKIE.length + 1) ?? "";
}

export async function isV4SessionValid(request: Request, env: V4AuthEnvironment): Promise<boolean> {
  if (!configured(env)) return false;
  const actual = readCookie(request);
  if (!actual) return false;
  return constantTimeEqual(actual, await sha256(`${env.V4_SESSION_SECRET}:${env.V4_ACCESS_TOKEN}`));
}

export async function createV4AccessResponse(request: Request, env: V4AuthEnvironment): Promise<Response> {
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
  if (!configured(env)) return new Response("Preview access is not configured", { status: 503 });
  const token = decodeURIComponent(new URL(request.url).pathname.slice("/access/".length));
  const accepted = constantTimeEqual(await sha256(token), await sha256(env.V4_ACCESS_TOKEN));
  if (!accepted) return new Response("Invalid preview access link", { status: 401, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });

  const headers = new Headers({
    location: new URL("/office-v4", request.url).toString(),
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "set-cookie": `${V4_SESSION_COOKIE}=${await sha256(`${env.V4_SESSION_SECRET}:${env.V4_ACCESS_TOKEN}`)}; Path=/; Max-Age=43200; HttpOnly; Secure; SameSite=Strict`,
  });
  return new Response(null, { status: 302, headers });
}
