import { NextResponse } from "next/server";

import { handle, readJson } from "@/lib/api";
import { getV5Repository, v5Secret } from "@/lib/billing-v5/repository";
import { isV5Server } from "@/lib/billing-v5/runtime";
import {
  findTopicProject,
  parseTelegramTopicInput,
  sameSecret,
} from "@/lib/billing-v5/telegram-topic-intake";
import type { Store } from "@/lib/data/store";

export const dynamic = "force-dynamic";

/**
 * Machine-to-machine intake for PIMO. Separate from the browser session:
 * it requires `Authorization: Bearer <PIMO_INTAKE_TOKEN>` (a Worker Secret)
 * and is disabled while that Secret is not set. It never uses the pilot or
 * access-link session, so it does not widen or replace existing sign-in.
 */
function denied(): NextResponse | null {
  if (!isV5Server()) {
    return NextResponse.json({ ok: false, code: "NOT_FOUND", message: "Not found." }, { status: 404 });
  }
  if (!v5Secret("PIMO_INTAKE_TOKEN")) {
    return NextResponse.json({ ok: false, code: "INTAKE_DISABLED", message: "Telegram intake is not enabled." }, { status: 503 });
  }
  return null;
}

function authorized(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return sameSecret(token, v5Secret("PIMO_INTAKE_TOKEN") ?? "");
}

const unauthorized = () =>
  NextResponse.json({ ok: false, code: "UNAUTHENTICATED", message: "Invalid intake token." }, { status: 401 });

const view = (project: { id: string; name: string; date: string; deletedAt?: string | null }) => ({
  id: project.id,
  name: project.name,
  date: project.date,
  deleted: Boolean(project.deletedAt),
});

/** Duplicate check: GET ?chatId=-100…&topicId=123 */
export async function GET(request: Request) {
  const blocked = denied();
  if (blocked) return blocked;
  if (!authorized(request)) return unauthorized();
  const url = new URL(request.url);
  const chatId = url.searchParams.get("chatId") ?? "";
  const topicId = Number(url.searchParams.get("topicId"));
  return handle(async () => {
    const snapshot = await (getV5Repository() as Store).getSnapshot();
    const project = findTopicProject(snapshot, chatId, topicId);
    return { found: Boolean(project), project: project ? view(project) : null };
  });
}

/** Register a new topic as a project (idempotent per chatId + topicId). */
export async function POST(request: Request) {
  const blocked = denied();
  if (blocked) return blocked;
  if (!authorized(request)) return unauthorized();
  const body = await readJson(request);
  return handle(async () => {
    const input = parseTelegramTopicInput(body);
    const store = getV5Repository() as Store;
    const existing = findTopicProject(await store.getSnapshot(), input.chatId, input.topicId);
    if (existing) return { status: existing.deletedAt ? "deleted" : "exists", project: view(existing) };
    const result = await store.registerTelegramTopic(input);
    return { status: result.status, project: view(result.project) };
  });
}
