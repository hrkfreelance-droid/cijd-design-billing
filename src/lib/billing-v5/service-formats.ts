import { RuleError } from "../data/repository";
import { serviceDefinitionForKey } from "../billing-v2/services";
import type { Database, ServiceFormat } from "../types";

export function saveServiceFormat(db: Database, input: Record<string, unknown>, actor: string): ServiceFormat {
  const text = (key: string, max: number) => {
    if (typeof input[key] !== "string" || (input[key] as string).length > max) throw new RuleError("INVALID", `Invalid ${key}.`, 400);
    return (input[key] as string).trim();
  };
  const name = text("name", 200), description = text("description", 2000), unit = text("unit", 50), serviceKey = text("serviceKey", 100);
  const id = input.id === undefined ? `custom:${crypto.randomUUID()}` : text("id", 300);
  if (!id || !name || !description || serviceDefinitionForKey(serviceKey, db.serviceTypes).key !== serviceKey) throw new RuleError("INVALID", "Enter a name, description and valid service.", 400);
  if (typeof input.quantity !== "number" || !Number.isFinite(input.quantity) || input.quantity <= 0) throw new RuleError("INVALID", "Quantity must be more than zero.", 400);
  const price = input.defaultUnitPrice;
  if (price !== null && (typeof price !== "number" || !Number.isFinite(price) || price < 0)) throw new RuleError("INVALID", "Unit price must be zero or more.", 400);
  if (typeof input.active !== "boolean") throw new RuleError("INVALID", "Invalid active flag.", 400);
  const next: ServiceFormat = { id, name, description, unit, serviceKey, quantity: input.quantity,
    defaultUnitPrice: price === null ? null : Math.round((price as number) * 100) / 100,
    active: input.active, updatedAt: new Date().toISOString(), updatedBy: actor };
  db.serviceFormats ??= [];
  const at = db.serviceFormats.findIndex((format) => format.id === id);
  if (at < 0) db.serviceFormats.push(next);
  else db.serviceFormats[at] = next;
  db.auditLogs.push({ id: crypto.randomUUID(), at: next.updatedAt!, actor, action: "service-format.save", entity: "service_format", entityId: id, detail: name });
  return next;
}
