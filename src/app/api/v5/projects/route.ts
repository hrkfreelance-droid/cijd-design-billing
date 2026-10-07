import { readJson, str } from "@/lib/api";
import { handleV5 } from "@/lib/billing-v5/api";
import { getV5Persistence } from "@/lib/billing-v5/repository";
import { createWorkProject } from "@/lib/billing-v5/work-types";

export async function POST(request: Request) {
  const body = await readJson(request);
  return handleV5(["production:write"], async (_store, user) => {
    const persistence = getV5Persistence();
    const db = (await persistence.read())!;
    const project = createWorkProject(db, {clientId: str(body.clientId) ?? "", name: str(body.name) ?? "", workType: body.workType}, user.name);
    await persistence.write(db);
    return project;
  });
}
