import { v4Handle, v4Repo } from "@/lib/v4/api";
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) { const { id } = await params; return v4Handle(() => v4Repo().then((repo) => repo.issue(id))); }
