/**
 * PIMO → CIJD Billing V5: a new Telegram forum topic becomes a new project.
 *
 * Scope is deliberately narrow:
 * - it only ever ADDS a project (In Progress, no billing lines, no amount);
 * - it never edits, renames or deletes an existing project, and never touches
 *   billing items, invoices, tax invoices, payments or customers;
 * - one Telegram topic (chat id + topic id) maps to at most one project,
 *   recorded as a marker in the project note, so retries and topic renames
 *   can never create a second project.
 */
import { RuleError } from "@/lib/data/repository";
import type { Project } from "@/lib/types";

/** Customers PIMO may add projects for. Exact company name match only. */
export const TELEGRAM_INTAKE_CUSTOMERS = ["Ringerhut(Cambodia) CO.,Ltd"] as const;

export const TELEGRAM_INTAKE_ACTOR = "PIMO (Telegram)";

export interface TelegramTopicInput {
  customerName: string;
  chatId: string;
  topicId: number;
  topicName: string;
  /** ISO timestamp of the topic creation (Telegram service message date). */
  createdAt: string;
  link?: string | null;
}

export type TelegramTopicResult =
  | { status: "created"; project: Project }
  | { status: "exists"; project: Project }
  | { status: "deleted"; project: Project }
  | { status: "name_exists"; project: Project };

interface DbLike {
  clients: { id: string; name: string; active: boolean }[];
  customers?: { id: string; companyNameEn?: string; active?: boolean }[];
  projects: Project[];
}

export function topicMarker(chatId: string, topicId: number): string {
  return `pimo-tg:${chatId}:${topicId}`;
}

const normName = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

/** Validate an untrusted request body. Throws RuleError(INVALID) on anything off. */
export function parseTelegramTopicInput(body: Record<string, unknown>): TelegramTopicInput {
  const chatId = typeof body.chatId === "string" ? body.chatId.trim() : String(body.chatId ?? "");
  const topicId = typeof body.topicId === "number" ? body.topicId : Number(body.topicId);
  const topicName = typeof body.topicName === "string" ? body.topicName.normalize("NFKC").trim() : "";
  const createdAt = typeof body.createdAt === "string" ? body.createdAt : "";
  const customerName = typeof body.customerName === "string" ? body.customerName.trim() : "";
  const link = typeof body.link === "string" && body.link ? body.link.trim() : null;

  if (!/^-?\d{1,20}$/.test(chatId)) throw new RuleError("INVALID", "chatId is invalid.", 400);
  if (!Number.isInteger(topicId) || topicId <= 1) throw new RuleError("INVALID", "topicId is invalid.", 400);
  if (!topicName || topicName.length > 200) throw new RuleError("INVALID", "topicName is required (max 200).", 400);
  if (Number.isNaN(Date.parse(createdAt))) throw new RuleError("INVALID", "createdAt must be an ISO timestamp.", 400);
  if (link && !/^https:\/\/t\.me\/[\w/+-]+$/.test(link)) throw new RuleError("INVALID", "link must be a t.me link.", 400);
  if (!(TELEGRAM_INTAKE_CUSTOMERS as readonly string[]).includes(customerName)) {
    throw new RuleError("CUSTOMER_NOT_ALLOWED", "This customer is not enabled for Telegram intake.", 403);
  }
  return { customerName, chatId, topicId, topicName, createdAt, link };
}

/** The one active client whose customer/company name matches exactly. */
export function resolveIntakeClient(db: DbLike, customerName: string): string {
  const target = normName(customerName);
  const ids = new Set<string>();
  for (const customer of db.customers ?? []) {
    if (customer.active !== false && normName(customer.companyNameEn ?? "") === target) ids.add(customer.id);
  }
  for (const client of db.clients) {
    if (client.active && normName(client.name) === target) ids.add(client.id);
  }
  const active = [...ids].filter((id) => db.clients.some((client) => client.id === id && client.active));
  if (active.length === 0) throw new RuleError("CUSTOMER_NOT_FOUND", "Customer was not found.", 404);
  if (active.length > 1) throw new RuleError("CUSTOMER_AMBIGUOUS", "More than one customer matches.", 409);
  return active[0];
}

/** Read-only lookup: the project already linked to this topic, if any. */
export function findTopicProject(db: DbLike, chatId: string, topicId: number): Project | undefined {
  const marker = topicMarker(chatId, topicId);
  const linked = db.projects.filter((project) => (project.note ?? "").split(/\s+/).includes(marker));
  return linked.find((project) => !project.deletedAt) ?? linked[0];
}

/** Phnom Penh calendar date (UTC+7, no DST) of an ISO timestamp. */
export function phnomPenhDate(iso: string): string {
  return new Date(Date.parse(iso) + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * Decide what to do. Pure: returns the project to add (status "created")
 * without mutating `db`; the caller pushes it inside its transaction.
 */
export function planTelegramTopic(
  db: DbLike,
  input: TelegramTopicInput,
  ids: { newId: () => string; now: () => string },
): TelegramTopicResult {
  const clientId = resolveIntakeClient(db, input.customerName);
  const linked = findTopicProject(db, input.chatId, input.topicId);
  if (linked) return { status: linked.deletedAt ? "deleted" : "exists", project: linked };

  const sameName = db.projects.find(
    (project) => project.clientId === clientId && !project.deletedAt && normName(project.name) === normName(input.topicName),
  );
  if (sameName) return { status: "name_exists", project: sameName };

  const at = ids.now();
  const note = [`Telegram topic: ${input.link ?? `chat ${input.chatId} / topic ${input.topicId}`}`, topicMarker(input.chatId, input.topicId)].join("\n");
  const project: Project = {
    id: ids.newId(),
    clientId,
    name: input.topicName,
    date: phnomPenhDate(input.createdAt),
    note,
    createdAt: at,
    createdBy: TELEGRAM_INTAKE_ACTOR,
    updatedAt: at,
    updatedBy: TELEGRAM_INTAKE_ACTOR,
    deletedAt: null,
    billingReadiness: "AUTO",
  } as Project;
  return { status: "created", project };
}

/** Constant-time comparison of two strings (bearer token check). */
export function sameSecret(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0 && expected.length > 0;
}
