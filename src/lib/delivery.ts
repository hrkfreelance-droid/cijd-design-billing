import { getRepository } from "@/lib/data";
import { notifyDelivery } from "@/lib/telegram/notify";
import type { BillingItem } from "@/lib/types";

/**
 * Runs after a delivery is already saved. Nothing in here can throw: a Telegram
 * or configuration problem must never turn a completed delivery into an error.
 */
export async function announceDelivery(projectId: string, items: BillingItem[]) {
  if (!items.length) return;
  try {
    const repo = await getRepository();
    const snapshot = await repo.getSnapshot();
    const project = snapshot.projects.find((candidate) => candidate.id === projectId);
    const client = project
      ? snapshot.clients.find((candidate) => candidate.id === project.clientId)
      : undefined;
    if (!project || !client) return;
    await notifyDelivery(repo, {
      client,
      project,
      items,
      deliveredAt: items[0]?.deliveredAt ?? new Date().toISOString(),
    });
  } catch (error) {
    console.error("[delivery] notification step failed", error);
  }
}
