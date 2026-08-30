import { redirect } from "next/navigation";

import { currentUser } from "@/lib/auth/session";
import { homeFor } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/** Each role starts in its own workspace rather than a shared dashboard. */
export default async function Home() {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "1") redirect("/signin");
  const user = await currentUser();
  redirect(user ? homeFor(user.role) : "/signin");
}
