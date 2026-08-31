"use client";

import { ApiError } from "@/lib/api-error";
import { GuardedRepository } from "@/lib/auth/guarded-repository";
import type { SessionUser } from "@/lib/auth/session";
import { notifyDelivery } from "@/lib/telegram/notify";
import type { BillingStatus, ItemType, ReceiptStatus } from "@/lib/types";
import { browserPersistence, clearDemoData } from "./browser-persistence";
import { RuleError, type Repository } from "./repository";
import { Store } from "./store";
import { isDemoMode } from "@/lib/runtime";

/** True only for a development/public preview, never for a production build. */
export const DEMO_MODE = isDemoMode;

const USER_KEY = "cijd.demo.user";
let store: Repository | null = null;

function repository(): Repository {
  if (!store) {
    const params = new URLSearchParams(window.location.search);
    if (params.has("reset")) {
      clearDemoData();
      localStorage.removeItem(USER_KEY);
      params.delete("reset");
      const query = params.toString();
      window.history.replaceState(
        null,
        "",
        window.location.pathname + (query ? `?${query}` : ""),
      );
    }
    store = new Store(browserPersistence);
  }
  return store;
}

async function currentDemoUser(): Promise<SessionUser | null> {
  const id = localStorage.getItem(USER_KEY);
  if (!id) return null;
  const user = (await repository().rawUsers()).find((candidate) => candidate.id === id);
  return user ? { id: user.id, name: user.name, role: user.role } : null;
}

type Body = Record<string, unknown>;

const str = (value: unknown) => (typeof value === "string" ? value : undefined);
const num = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
};

async function announce(repo: Repository, projectId: string, items: { id: string; deliveredAt?: string | null }[]) {
  const snapshot = await repo.getSnapshot();
  const project = snapshot.projects.find((candidate) => candidate.id === projectId);
  const client = project
    ? snapshot.clients.find((candidate) => candidate.id === project.clientId)
    : undefined;
  const full = snapshot.billingItems.filter((item) => items.some((i) => i.id === item.id));
  if (!project || !client || !full.length) return;
  await notifyDelivery(repo, {
    client,
    project,
    items: full,
    deliveredAt: full[0]?.deliveredAt ?? new Date().toISOString(),
  });
}

/**
 * Mirrors src/app/api/** against the in-browser store, including the role
 * checks — the preview behaves like the real thing, minus the server.
 */
export async function demoRequest<T>(
  path: string,
  method: string,
  input?: unknown,
): Promise<T> {
  const repo = repository();
  const body = (input ?? {}) as Body;
  const [resource, id, sub] = path.split("?")[0].replace(/^\/api\//, "").split("/");

  try {
    if (resource === "session") {
      const users = await repo.rawUsers();
      if (method === "GET") {
        return { user: await currentDemoUser(), users } as T;
      }
      if (method === "POST") {
        const wanted = users.find((user) => user.id === str(body.userId));
        if (!wanted) throw new ApiError("Unknown user.", "NOT_FOUND");
        localStorage.setItem(USER_KEY, wanted.id);
        return wanted as T;
      }
      localStorage.removeItem(USER_KEY);
      return null as T;
    }

    const user = await currentDemoUser();
    if (!user) throw new ApiError("Sign in to continue.", "UNAUTHENTICATED");
    const guarded = new GuardedRepository(repo, user);

    if (resource === "state") return (await guarded.getSnapshot()) as T;

    if (resource === "clients") {
      if (method === "POST") return (await guarded.createClient({ name: str(body.name) ?? "" })) as T;
      if (method === "PATCH" && id) {
        return (await guarded.updateClient(id, {
          name: str(body.name),
          active: typeof body.active === "boolean" ? body.active : undefined,
        })) as T;
      }
    }

    if (resource === "projects") {
      if (method === "POST" && !id) {
        return (await guarded.createProject({
          clientId: str(body.clientId) ?? "",
          name: str(body.name) ?? "",
          createdBy: str(body.createdBy),
          date: str(body.date),
          note: str(body.note),
        })) as T;
      }
      if (id && sub === "delivery") {
        if (method === "POST") {
          const items = await guarded.setProjectDelivery(id, true);
          await announce(repo, id, items);
          return items as T;
        }
        if (method === "DELETE") return (await guarded.setProjectDelivery(id, false)) as T;
      }
      if (method === "PATCH" && id) {
        return (await guarded.updateProject(id, {
          name: str(body.name),
          date: str(body.date),
          note: str(body.note),
          clientId: str(body.clientId),
        })) as T;
      }
    }

    if (resource === "billing-items") {
      if (method === "POST" && !id) {
        return (await guarded.createBillingItem({
          projectId: str(body.projectId) ?? "",
          description: str(body.description) ?? "",
          type: str(body.type) as ItemType | undefined,
          quantity: num(body.quantity),
          unitPrice: num(body.unitPrice),
          amount: num(body.amount),
          billingStatus: str(body.billingStatus) as BillingStatus | undefined,
          note: str(body.note),
        })) as T;
      }
      if (id && sub === "delivery") {
        if (method === "POST") {
          const item = await guarded.setItemDelivery(id, true);
          await announce(repo, item.projectId, [item]);
          return item as T;
        }
        if (method === "DELETE") return (await guarded.setItemDelivery(id, false)) as T;
      }
      if (id && sub === "complete") {
        if (method === "POST") {
          return (await guarded.setItemCompletion(id, true)) as T;
        }
        if (method === "DELETE") return (await guarded.setItemCompletion(id, false)) as T;
      }
      if (method === "PATCH" && id) {
        const billingStatus = str(body.billingStatus) as BillingStatus | undefined;
        if (billingStatus) return (await guarded.setBillingStatus(id, billingStatus)) as T;
        return (await guarded.updateBillingItem(id, {
          description: str(body.description),
          type: str(body.type) as ItemType | undefined,
          quantity: num(body.quantity),
          unitPrice: num(body.unitPrice),
          amount: body.amount === null ? null : num(body.amount),
          note: str(body.note),
        })) as T;
      }
      if (method === "DELETE" && id) return (await guarded.deleteBillingItem(id)) as T;
    }

    if (resource === "invoices") {
      if (method === "POST" && !id) {
        const ids = Array.isArray(body.billingItemIds)
          ? body.billingItemIds.filter((value): value is string => typeof value === "string")
          : [];
        return (await guarded.createInvoice({
          clientId: str(body.clientId) ?? "",
          invoiceNumber: str(body.invoiceNumber) ?? "",
          invoiceDate: str(body.invoiceDate) ?? "",
          billingItemIds: ids,
        })) as T;
      }
      if (id && sub === "payment") {
        if (method === "POST") {
          return (await guarded.confirmPayment(id, {
            paymentDate: str(body.paymentDate) ?? "",
            slip: str(body.slip),
          })) as T;
        }
        if (method === "DELETE") return (await guarded.revertPayment(id)) as T;
      }
      if (id && !sub) {
        if (method === "PATCH") {
          return (await guarded.setReceiptStatus(
            id,
            (str(body.receiptStatus) as ReceiptStatus | undefined) ?? "PENDING",
          )) as T;
        }
        if (method === "DELETE") return (await guarded.voidInvoice(id)) as T;
      }
    }

    if (resource === "notifications" && method === "GET" && !id) {
      return (await guarded.listNotifications()) as T;
    }

    throw new ApiError(`Unsupported request: ${method} ${path}`, "NOT_FOUND");
  } catch (error) {
    if (error instanceof RuleError) throw new ApiError(error.message, error.code);
    throw error;
  }
}
