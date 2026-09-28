import handler from "vinext/server/fetch-handler";
import { handleV4Api } from "../src/server/v4-api";
import { createV4AccessResponse, isV4SessionValid } from "../src/server/worker-auth";
import type { D1Database } from "../src/server/d1-types";

interface V4Environment extends Record<string, unknown> {
  DB: D1Database;
  V4_ACCESS_TOKEN?: string;
  V4_SESSION_SECRET?: string;
}

function isPrivatePath(pathname: string): boolean {
  return pathname === "/office-v4" || pathname.startsWith("/office-v4/") || pathname === "/api/v4" || pathname.startsWith("/api/v4/");
}

function noStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request: Request, env: V4Environment, ctx: { waitUntil(promise: Promise<unknown>): void }) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/access/")) return createV4AccessResponse(request, env);

    if (isPrivatePath(url.pathname) && !(await isV4SessionValid(request, env))) {
      if (url.pathname === "/api/v4" || url.pathname.startsWith("/api/v4/")) {
        return noStore(Response.json({ error: "Unauthorized" }, { status: 401 }));
      }
      return Response.redirect(new URL("/", request.url), 302);
    }

    if (url.pathname === "/api/v4" || url.pathname.startsWith("/api/v4/")) {
      return noStore(await handleV4Api(request, env));
    }

    return handler.fetch(request, env, ctx);
  },
};
