import { readJson, str } from "@/lib/api";
import { v4Handle, v4Repo } from "@/lib/v4/api";
export async function GET(request: Request) { const search = new URL(request.url).searchParams.get("search") ?? ""; return v4Handle(() => v4Repo().then((repo) => repo.listCustomers(search))); }
export async function POST(request: Request) { const body = await readJson(request); return v4Handle(() => v4Repo().then((repo) => repo.createCustomer({ name: str(body.name) ?? "", khmerName: str(body.khmerName), address: str(body.address), phone: str(body.phone), vatin: str(body.vatin) }))); }
