import { handleAs } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  return handleAs((repo) => repo.getSnapshot());
}
