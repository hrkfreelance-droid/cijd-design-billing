import { NextResponse } from "next/server";

import { supabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function callbackError(requestUrl: URL) {
  return NextResponse.redirect(new URL("/signin?error=auth_callback", requestUrl));
}

function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

/** Exchanges the Google PKCE code, then lets the server choose homeFor(role). */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  if (!code) return callbackError(requestUrl);

  const client = await supabaseServerClient();
  if (!client) return callbackError(requestUrl);

  const { error } = await client.auth.exchangeCodeForSession(code);
  if (error) return callbackError(requestUrl);

  return NextResponse.redirect(new URL(safeNext(requestUrl.searchParams.get("next")), requestUrl));
}
