import { getV5Persistence, v5Secret } from "./repository";
import { isV5Server } from "./runtime";
import {
  hasBusinessData,
  IMPORTED_COLLECTIONS,
  summarize,
  type ImportedCollection,
} from "./v3-import";
import type { Database } from "../types";

/**
 * The one-time V3 → V5 import (scripts/v5-import/v3-to-v5.ts).
 *
 * Exists only on the V5 Worker, only while the V5_IMPORT_TOKEN secret is set,
 * and only into a V5 that holds no business data yet. It stores exactly the
 * records it is given — no prices are recalculated — and answers with what it
 * reads back from D1.
 */
function denied(status: number, code: string, message: string) {
  return Response.json({ ok: false, code, message }, { status });
}

function authorised(request: Request): Response | null {
  if (!isV5Server()) return denied(404, "NOT_FOUND", "Not found.");
  const token = v5Secret("V5_IMPORT_TOKEN");
  if (!token) return denied(404, "NOT_FOUND", "Import is not enabled.");
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  let diff = given.length ^ token.length;
  for (let i = 0; i < Math.max(given.length, token.length); i += 1) {
    diff |= (given.charCodeAt(i) || 0) ^ (token.charCodeAt(i) || 0);
  }
  return diff === 0 ? null : denied(401, "UNAUTHENTICATED", "Wrong import token.");
}

function readBack(db: Database) {
  const collections = Object.fromEntries(IMPORTED_COLLECTIONS.map((key) => [key, db[key] ?? []])) as Pick<Database, ImportedCollection>;
  return {
    summary: summarize(collections),
    clients: collections.clients,
    projects: collections.projects,
    billingItems: collections.billingItems,
  };
}

/** What V5 holds now, including soft-deleted rows, for verification. */
export async function importGET(request: Request) {
  const refusal = authorised(request);
  if (refusal) return refusal;
  const db = await getV5Persistence().read();
  return Response.json({ ok: true, data: readBack(db!) });
}

export async function importPOST(request: Request) {
  const refusal = authorised(request);
  if (refusal) return refusal;
  let body: { collections?: Record<string, unknown>; source?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return denied(400, "INVALID", "Body must be JSON.");
  }
  const incoming = body.collections ?? {};
  for (const key of IMPORTED_COLLECTIONS) {
    if (!Array.isArray(incoming[key])) return denied(400, "INVALID", `collections.${key} must be an array.`);
  }

  const persistence = getV5Persistence();
  const db = (await persistence.read())!;
  if (hasBusinessData(db)) {
    return denied(409, "V5_NOT_EMPTY", "V5 already holds business data. The import only runs into an empty V5.");
  }

  const at = new Date().toISOString();
  for (const key of IMPORTED_COLLECTIONS) {
    const records = incoming[key] as never[];
    // Keep V5's own service types / users when V3 sent none.
    if ((key === "serviceTypes" || key === "users") && records.length === 0) continue;
    (db as unknown as Record<string, unknown>)[key] = records;
  }
  if (!db.users.some((user) => user.role === "ADMIN")) db.users.push({ id: "u_admin", name: "Admin", role: "ADMIN" });
  db.auditLogs.push({
    id: globalThis.crypto.randomUUID(),
    at,
    actor: "v3-import",
    action: "v5.import.v3",
    entity: "database",
    entityId: "v5",
    detail: `${body.source ?? "V3"}: ${IMPORTED_COLLECTIONS.map((key) => `${key}=${(incoming[key] as unknown[]).length}`).join(" ")}`,
  });
  await persistence.write(db);

  const stored = (await getV5Persistence().read())!;
  return Response.json({ ok: true, data: readBack(stored) });
}
