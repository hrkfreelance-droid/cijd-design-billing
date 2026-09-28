import "server-only";

import { cookies } from "next/headers";

import { V4_SESSION_COOKIE } from "@/server/worker-auth";

export async function isAuthorized(): Promise<boolean> {
  return Boolean((await cookies()).get(V4_SESSION_COOKIE)?.value);
}
