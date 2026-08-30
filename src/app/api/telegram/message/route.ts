import { NextResponse } from "next/server";

import { handle, readJson, str } from "@/lib/api";
import { getServiceRepository } from "@/lib/data";
import { handleTelegramMessage } from "@/lib/telegram/intake";

/**
 * The bot process posts messages here. It is disabled unless
 * TELEGRAM_WEBHOOK_SECRET is set, so it is never an open endpoint.
 */
export async function POST(request: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, code: "DISABLED", message: "TELEGRAM_WEBHOOK_SECRET is not set." },
      { status: 503 },
    );
  }
  if (request.headers.get("x-telegram-secret") !== secret) {
    return NextResponse.json(
      { ok: false, code: "FORBIDDEN", message: "Bad secret." },
      { status: 403 },
    );
  }
  const body = await readJson(request);
  const chatId = str(body.chatId) ?? "";
  const text = str(body.text) ?? "";
  if (!chatId) {
    return NextResponse.json(
      { ok: false, code: "INVALID", message: "chatId is required." },
      { status: 400 },
    );
  }
  return handle(async () =>
    handleTelegramMessage(
      await getServiceRepository(),
      chatId,
      text,
      process.env.TELEGRAM_ACTOR ?? "Hiroki",
    ),
  );
}
