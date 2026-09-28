import type { BillingItem, Customer } from "@/domain/types";
import { createD1Repository, RepositoryError } from "@/server/d1-repository";
import type { D1Database } from "@/server/d1-types";
import { fetchNbcRate } from "@/server/nbc";

export interface V4ApiEnvironment {
  DB: D1Database;
}

async function jsonBody<T>(request: Request): Promise<T> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) throw new RepositoryError("JSON body required", 415);
  try {
    return await request.json() as T;
  } catch {
    throw new RepositoryError("Invalid JSON body", 400);
  }
}

function apiError(error: unknown): Response {
  const message = error instanceof Error ? error.message : "Unexpected error";
  if (/UNIQUE constraint failed: (?:main\.)?billing_item_claims\.billing_item_id/i.test(message)) {
    return Response.json({ error: "A selected billing item is already part of an issued invoice" }, { status: 409 });
  }
  const status = error instanceof RepositoryError ? error.status : 500;
  return Response.json({ error: message }, { status });
}

function pathParts(pathname: string): string[] | null {
  if (pathname !== "/api/v4" && !pathname.startsWith("/api/v4/")) return null;
  const suffix = pathname.slice("/api/v4".length).replace(/^\/+/, "");
  if (!suffix) return [];
  try {
    return suffix.split("/").map((part) => decodeURIComponent(part));
  } catch {
    return [];
  }
}

export async function handleV4Api(request: Request, environment: V4ApiEnvironment): Promise<Response> {
  const parts = pathParts(new URL(request.url).pathname);
  if (!parts) return Response.json({ error: "Not found" }, { status: 404 });
  const repository = createD1Repository(environment.DB);

  try {
    if (parts.length === 1 && parts[0] === "bootstrap" && request.method === "GET") {
      return Response.json(await repository.bootstrap());
    }
    if (parts.length === 2 && parts[0] === "tax-invoices" && request.method === "GET") {
      return Response.json(await repository.getInvoice(parts[1]));
    }
    if (parts.length === 1 && parts[0] === "customers" && request.method === "POST") {
      return Response.json(await repository.createCustomer(await jsonBody<Partial<Customer>>(request)), { status: 201 });
    }
    if (parts.length === 2 && parts[0] === "customers" && request.method === "PATCH") {
      return Response.json(await repository.updateCustomer(parts[1], await jsonBody<Partial<Customer>>(request)));
    }
    if (parts.length === 1 && parts[0] === "projects" && request.method === "POST") {
      return Response.json(await repository.createProject(await jsonBody<{ customerId: string; code: string; title: string; depositUsd: number }>(request)), { status: 201 });
    }
    if (parts.length === 2 && parts[0] === "projects" && request.method === "PATCH") {
      return Response.json(await repository.updateProject(parts[1], await jsonBody<{ customerId: string; code: string; title: string; depositUsd: number }>(request)));
    }
    if (parts.length === 1 && parts[0] === "billing-items" && request.method === "POST") {
      return Response.json(await repository.saveBillingItem(await jsonBody<BillingInput>(request)), { status: 201 });
    }
    if (parts.length === 2 && parts[0] === "billing-items" && request.method === "PATCH") {
      return Response.json(await repository.saveBillingItem({ ...(await jsonBody<BillingInput>(request)), id: parts[1] }));
    }
    if (parts.length === 1 && parts[0] === "tax-invoices" && request.method === "POST") {
      return Response.json(await repository.createDraft(await jsonBody<{ projectId: string; invoiceDate: string; billingItemIds: string[] }>(request)), { status: 201 });
    }
    if (parts.length === 3 && parts[0] === "tax-invoices" && parts[2] === "issue" && request.method === "POST") {
      return Response.json(await repository.issueInvoice(parts[1]));
    }
    if (parts.length === 3 && parts[0] === "tax-invoices" && parts[2] === "cancel" && request.method === "POST") {
      const input = await jsonBody<{ reason: string }>(request);
      return Response.json(await repository.cancelInvoice(parts[1], input.reason ?? ""));
    }
    if (parts.length === 3 && parts[0] === "tax-invoices" && parts[2] === "duplicate" && request.method === "POST") {
      return Response.json(await repository.duplicateInvoice(parts[1]), { status: 201 });
    }
    if (parts.join("/") === "exchange-rate/refresh" && request.method === "POST") {
      return Response.json(await repository.saveExchangeRate(await fetchNbcRate()));
    }
    return Response.json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    return apiError(error);
  }
}

type BillingInput = Omit<BillingItem, "id" | "createdAt" | "updatedAt" | "invoicedAt"> & { id?: string };
