import { readJson, str } from "@/lib/api";
import { v4Handle, v4Repo } from "@/lib/v4/api";
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) { const body = await readJson(request); const { id } = await params; return v4Handle(() => v4Repo().then((repo) => repo.updateCustomer(id, { name: str(body.name), khmerName: str(body.khmerName), address: str(body.address), phone: str(body.phone), vatin: str(body.vatin) }))); }
