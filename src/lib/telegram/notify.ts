import type { BillingItem, Client, Project } from "@/lib/types";
import type { Repository } from "@/lib/data/repository";

/**
 * Delivery notifications for the billing side.
 *
 * The recipient is configured, never hard coded: set TELEGRAM_BOT_TOKEN and
 * TELEGRAM_BILLING_CHAT_ID once the chat ID is known. Until then deliveries
 * still work and each notification is recorded as skipped, ready to resend.
 */

function money(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(rounded);
}

function deliveredAtLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export function formatDeliveryMessage(
  client: Client,
  project: Project,
  items: BillingItem[],
  deliveredAt: string,
): string {
  const lines = [client.name, project.name, "Delivered"];
  for (const item of items) lines.push(`${item.description} — ${money(item.amount)}`);
  if (items.length > 1) {
    const total = items.reduce((sum, item) => sum + item.amount, 0);
    lines.push(`Total — ${money(total)}`);
  }
  const ready = items.every((item) => item.billingStatus === "READY_TO_INVOICE");
  lines.push(ready ? "Ready to invoice." : "Price review required before invoicing.");
  lines.push(`Delivered: ${deliveredAtLabel(deliveredAt)}`);
  return lines.join("\n");
}

export function deliveryDedupeKey(projectId: string, deliveredAt: string, itemIds: string[]) {
  return `delivery:${projectId}:${deliveredAt}:${[...itemIds].sort().join("|")}`;
}

export interface SendResult {
  ok: boolean;
  skipped?: boolean;
  error?: string;
}

export async function sendTelegramMessage(text: string): Promise<SendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_BILLING_CHAT_ID;
  if (!token || !chatId) {
    return { ok: false, skipped: true, error: "TELEGRAM_BILLING_CHAT_ID is not configured" };
  }
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { ok: false, error: `Telegram responded ${response.status} ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "send failed" };
  }
}

/**
 * Records the notification first, then tries to send it. This never throws:
 * a delivery that has been saved stays saved even if Telegram is unreachable.
 */
export async function notifyDelivery(
  repo: Repository,
  args: { client: Client; project: Project; items: BillingItem[]; deliveredAt: string },
): Promise<void> {
  try {
    const text = formatDeliveryMessage(
      args.client,
      args.project,
      args.items,
      args.deliveredAt,
    );
    const notification = await repo.queueNotification({
      kind: "DELIVERY",
      dedupeKey: deliveryDedupeKey(
        args.project.id,
        args.deliveredAt,
        args.items.map((item) => item.id),
      ),
      projectId: args.project.id,
      text,
    });
    // Already queued or sent for this exact delivery: nothing more to do.
    if (!notification) return;
    const result = await sendTelegramMessage(text);
    await repo.markNotification(
      notification.id,
      result.ok ? "SENT" : result.skipped ? "SKIPPED" : "FAILED",
      result.error,
    );
  } catch (error) {
    console.error("[telegram] delivery notification failed", error);
  }
}

/** Retries one recorded notification. Safe to call repeatedly. */
export async function resendNotification(
  repo: Repository,
  id: string,
): Promise<SendResult> {
  const notification = await repo.getNotification(id);
  if (!notification) return { ok: false, error: "not found" };
  if (notification.status === "SENT") return { ok: true };
  const result = await sendTelegramMessage(notification.text);
  await repo.markNotification(
    id,
    result.ok ? "SENT" : result.skipped ? "SKIPPED" : "FAILED",
    result.error,
  );
  return result;
}
