/**
 * Telegram intake for the designer workflow.
 *
 * Long polls Telegram and forwards each message to the running app, so it needs
 * no public URL. Configure with environment variables (never commit them):
 *
 *   TELEGRAM_BOT_TOKEN=...          # from @BotFather
 *   TELEGRAM_WEBHOOK_SECRET=...     # any random string, also set for the app
 *   APP_URL=http://localhost:3000   # optional
 *
 *   npm run telegram
 *
 * Send the bot a project name to register it, and "納品済み" to deliver.
 */
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const appUrl = process.env.APP_URL ?? "http://localhost:3000";

if (!token || !secret) {
  console.error(
    "TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET must be set (see .env.example).",
  );
  process.exit(1);
}

const api = (method, body) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((response) => response.json());

async function handle(message) {
  const chatId = String(message.chat.id);
  const text = message.text ?? "";
  try {
    const response = await fetch(`${appUrl}/api/telegram/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-telegram-secret": secret },
      body: JSON.stringify({ chatId, text }),
    });
    const payload = await response.json();
    const reply = payload?.data?.reply ?? payload?.message ?? "処理できませんでした。";
    await api("sendMessage", { chat_id: chatId, text: reply });
  } catch (error) {
    console.error("[telegram] handling failed", error);
    await api("sendMessage", {
      chat_id: chatId,
      text: "アプリに接続できませんでした。",
    }).catch(() => {});
  }
}

let offset = 0;
console.log(`Telegram bot polling. App: ${appUrl}`);
for (;;) {
  try {
    const updates = await api("getUpdates", { offset, timeout: 30 });
    for (const update of updates.result ?? []) {
      offset = update.update_id + 1;
      if (update.message?.text) await handle(update.message);
    }
  } catch (error) {
    console.error("[telegram] poll failed", error);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}
