import type { Repository } from "@/lib/data/repository";
import { RuleError } from "@/lib/data/repository";
import { isProductionComplete } from "@/lib/derive";
import type { Client, Project } from "@/lib/types";
import { notifyDelivery } from "./notify";

/**
 * The Telegram side of the designer's workflow: register a project by sending
 * its name, and close it out by sending "納品済み".
 *
 * When the target is not certain the bot asks rather than guessing — changing
 * the wrong project is worse than one extra message.
 */

const DELIVERED_WORDS = ["納品済み", "納品完了", "納品", "delivered", "done"];

function stripDeliveryWord(text: string): { isDelivery: boolean; rest: string } {
  const trimmed = text.trim();
  for (const word of DELIVERED_WORDS) {
    const lower = trimmed.toLowerCase();
    if (lower === word.toLowerCase()) return { isDelivery: true, rest: "" };
    if (lower.endsWith(` ${word.toLowerCase()}`) || trimmed.endsWith(word)) {
      return { isDelivery: true, rest: trimmed.slice(0, trimmed.length - word.length).trim() };
    }
  }
  return { isDelivery: false, rest: trimmed };
}

/** "Ringer Hut" also answers to "RH" — initials, not a hard coded alias list. */
function clientAliases(client: Client): string[] {
  const initials = client.name
    .split(/\s+/)
    .map((word) => word[0])
    .join("");
  return [client.name.toLowerCase(), initials.toLowerCase()].filter(Boolean);
}

function matchClient(clients: Client[], text: string): { client: Client; rest: string } | null {
  const lower = text.toLowerCase();
  let best: { client: Client; rest: string; length: number } | null = null;
  for (const client of clients) {
    for (const alias of clientAliases(client)) {
      if (!alias) continue;
      if (lower.startsWith(`${alias} `) || lower === alias) {
        // A short prefix like "RH" is part of how the project is named, so it
        // stays. Spelling the client out in full does not belong in the name.
        const rest = alias.length <= 4 ? text.trim() : text.slice(alias.length).trim();
        if (!best || alias.length > best.length) {
          best = { client, rest, length: alias.length };
        }
      }
    }
  }
  return best ? { client: best.client, rest: best.rest } : null;
}

function numbered(items: string[]): string {
  return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

export interface IntakeResult {
  reply: string;
}

export async function handleTelegramMessage(
  repo: Repository,
  chatId: string,
  rawText: string,
  actor = "Hiroki",
): Promise<IntakeResult> {
  const text = rawText.trim();
  if (!text) return { reply: "案件名を送ってください。" };

  const session = (await repo.getTelegramSession(chatId)) ?? {
    chatId,
    updatedAt: new Date().toISOString(),
  };
  const snapshot = await repo.getSnapshot();
  const activeClients = snapshot.clients.filter((client) => client.active);

  if (text === "/start" || text === "help" || text === "ヘルプ") {
    return {
      reply: [
        "案件登録：クライアント名か略称 + 案件名",
        "例）RH New Menu Poster",
        "",
        "納品：案件名 + 納品済み",
        "例）RH New Menu Poster 納品済み",
        "直前の案件なら「納品済み」だけでも大丈夫です。",
      ].join("\n"),
    };
  }

  // A bare number answers whichever question was asked last.
  const choice = /^[0-9]+$/.test(text) ? Number(text) : null;
  if (choice !== null && session.candidateIds?.length) {
    const id = session.candidateIds[choice - 1];
    if (!id) return { reply: "その番号はありません。もう一度選んでください。" };
    await repo.saveTelegramSession({ ...session, candidateIds: [], pendingProjectName: null });
    if (session.pendingProjectName) {
      return createProject(repo, chatId, session, id, session.pendingProjectName, actor);
    }
    return deliverProject(repo, chatId, session, id, actor);
  }

  const { isDelivery, rest } = stripDeliveryWord(text);

  if (isDelivery) {
    const target = rest || "";
    const candidates = await findDeliverableProjects(repo, target);

    if (!target) {
      if (session.lastProjectId) {
        return deliverProject(repo, chatId, session, session.lastProjectId, actor);
      }
      if (!candidates.length) return { reply: "納品できる案件が見つかりませんでした。" };
      await repo.saveTelegramSession({
        ...session,
        candidateIds: candidates.map((project) => project.id),
        pendingProjectName: null,
      });
      return {
        reply: `どの案件ですか？番号で返信してください。\n${numbered(
          candidates.map((project) => project.name),
        )}`,
      };
    }

    if (candidates.length === 1) {
      return deliverProject(repo, chatId, session, candidates[0].id, actor);
    }
    if (!candidates.length) {
      return { reply: `「${target}」に一致する未納品の案件が見つかりませんでした。` };
    }
    await repo.saveTelegramSession({
      ...session,
      candidateIds: candidates.map((project) => project.id),
      pendingProjectName: null,
    });
    return {
      reply: `候補が複数あります。番号で返信してください。\n${numbered(
        candidates.map((project) => project.name),
      )}`,
    };
  }

  // Otherwise this is a new project.
  const matched = matchClient(activeClients, text);
  if (!matched || !matched.rest) {
    await repo.saveTelegramSession({
      ...session,
      candidateIds: activeClients.map((client) => client.id),
      pendingProjectName: matched?.rest || text,
    });
    return {
      reply: `どのクライアントですか？番号で返信してください。\n${numbered(
        activeClients.map((client) => client.name),
      )}`,
    };
  }
  return createProject(repo, chatId, session, matched.client.id, matched.rest, actor);
}

async function findDeliverableProjects(repo: Repository, term: string): Promise<Project[]> {
  const snapshot = await repo.getSnapshot();
  const open = new Set(
    snapshot.billingItems
      .filter((item) => !isProductionComplete(item))
      .map((item) => item.projectId),
  );
  const lower = term.toLowerCase();
  return snapshot.projects
    .filter((project) => open.has(project.id))
    .filter((project) => (lower ? project.name.toLowerCase().includes(lower) : true))
    .sort((a, b) => b.date.localeCompare(a.date));
}

async function createProject(
  repo: Repository,
  chatId: string,
  session: { chatId: string; updatedAt: string; lastProjectId?: string | null },
  clientId: string,
  name: string,
  actor: string,
): Promise<IntakeResult> {
  try {
    const project = await repo.createProject({ clientId, name, createdBy: actor });
    await repo.saveTelegramSession({
      chatId,
      updatedAt: session.updatedAt,
      lastProjectId: project.id,
      candidateIds: [],
      pendingProjectName: null,
    });
    const snapshot = await repo.getSnapshot();
    const client = snapshot.clients.find((c) => c.id === clientId);
    return {
      reply: [
        `登録しました（進行中）`,
        `${client?.name ?? ""} / ${project.name}`,
        `${project.date} · ${actor}`,
        "",
        "請求項目はアプリから追加してください。納品時は「納品済み」と送ってください。",
      ].join("\n"),
    };
  } catch (error) {
    return { reply: describe(error) };
  }
}

async function deliverProject(
  repo: Repository,
  chatId: string,
  session: { chatId: string; updatedAt: string },
  projectId: string,
  actor: string,
): Promise<IntakeResult> {
  try {
    const items = await repo.setProjectDelivery(projectId, true, actor);
    await repo.saveTelegramSession({
      chatId,
      updatedAt: session.updatedAt,
      lastProjectId: projectId,
      candidateIds: [],
      pendingProjectName: null,
    });
    const snapshot = await repo.getSnapshot();
    const project = snapshot.projects.find((p) => p.id === projectId);
    const client = project ? snapshot.clients.find((c) => c.id === project.clientId) : undefined;
    if (project && client) {
      await notifyDelivery(repo, {
        client,
        project,
        items,
        deliveredAt: items[0]?.deliveredAt ?? new Date().toISOString(),
      });
    }
    const total = items.reduce((sum, item) => sum + item.amount, 0);
    return {
      reply: [
        "✓ 納品済みにしました",
        `${client?.name ?? ""} / ${project?.name ?? ""}`,
        `請求待ち ${items.length}件 · $${Math.round(total * 100) / 100}`,
      ].join("\n"),
    };
  } catch (error) {
    return { reply: describe(error) };
  }
}

function describe(error: unknown): string {
  if (error instanceof RuleError) {
    if (error.code === "NO_ITEMS") {
      return "この案件にはまだ請求項目がありません。アプリで追加してから納品済みにしてください。";
    }
    return error.message;
  }
  return "処理できませんでした。";
}
