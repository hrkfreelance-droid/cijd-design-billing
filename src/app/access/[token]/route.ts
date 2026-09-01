import { NextResponse } from "next/server";

import { homeFor } from "@/lib/auth/roles";
import { setAccessSession, verifyAccessLink } from "@/lib/auth/access-links";

export const dynamic = "force-dynamic";

/**
 * A secret link is a one-time bootstrap URL. It becomes an HttpOnly signed
 * session immediately, then the token disappears from the address bar.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const verified = await verifyAccessLink(token);
  if (!verified) {
    return new NextResponse("Not found", {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  }

  const requestUrl = new URL(request.url);
  const response = NextResponse.redirect(new URL(homeFor(verified.role), requestUrl));
  await setAccessSession(response, verified, requestUrl.protocol === "https:");
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
