/**
 * The services CIJD bills for.
 *
 * Adding one is a line in this table, not a screen. Each definition says how
 * the item is stored, whether it is priced from a cost, and which label to
 * show — so no component has to branch on a service name.
 *
 * `storageType` is the existing `billing_items.type` enum. A service that
 * needs its own persisted identity writes `billing_items.service_type`, a
 * plain text column, so a new service never needs an enum migration.
 */
import type { MessageKey } from "@/lib/i18n";
import type { BillingItem, ItemType } from "@/lib/types";

export type ServiceKey = string;

/**
 * `cost` services are bought in and marked up, so they show Cost and a
 * recommended price. `flat` services are simply priced.
 */
export type PricingModel = "flat" | "cost";

export interface ServiceDefinition {
  key: ServiceKey;
  labelKey: MessageKey;
  /** Custom service names do not have a translation key. */
  label?: string;
  storageType: ItemType;
  pricing: PricingModel;
  /** Offered services appear in the picker; the rest only render old rows. */
  offered: boolean;
}

export const SERVICES: readonly ServiceDefinition[] = [
  { key: "DESIGN", labelKey: "v2.service.DESIGN", storageType: "DESIGN", pricing: "flat", offered: true },
  { key: "PRINTING", labelKey: "v2.service.PRINTING", storageType: "PRINT", pricing: "cost", offered: true },
  { key: "PASSPORT", labelKey: "v2.service.PASSPORT", storageType: "OTHER", pricing: "flat", offered: true },
  { key: "OTHER", labelKey: "v2.service.OTHER", storageType: "OTHER", pricing: "flat", offered: true },
  // Kept so existing rows keep their own name; not offered for new work.
  { key: "RESIZE", labelKey: "v2.service.RESIZE", storageType: "RESIZE", pricing: "flat", offered: false },
  // Planned. Turning one on is this flag plus its label — nothing else.
  { key: "VISA", labelKey: "v2.service.VISA", storageType: "OTHER", pricing: "flat", offered: false },
  { key: "ATTEND", labelKey: "v2.service.ATTEND", storageType: "OTHER", pricing: "flat", offered: false },
  { key: "TRANSLATION", labelKey: "v2.service.TRANSLATION", storageType: "OTHER", pricing: "flat", offered: false },
];

export const OFFERED_SERVICES = SERVICES.filter((service) => service.offered);

const BY_KEY = new Map(SERVICES.map((service) => [service.key, service]));

export const DEFAULT_SERVICE = BY_KEY.get("DESIGN") as ServiceDefinition;

export function serviceByKey(key: string | null | undefined): ServiceDefinition | null {
  return (key && BY_KEY.get(key as ServiceKey)) || null;
}

export function serviceDefinitionForKey(
  key: string,
  serviceTypes: readonly { key: string; name: string; active: boolean }[] = [],
): ServiceDefinition {
  const builtIn = serviceByKey(key);
  if (builtIn) return builtIn;
  const custom = serviceTypes.find((service) => service.key === key);
  return custom
    ? {
        key: custom.key,
        labelKey: "v2.service.OTHER",
        label: custom.name,
        storageType: "OTHER",
        pricing: "flat",
        offered: custom.active,
      }
    : DEFAULT_SERVICE;
}

/**
 * What the service picker offers: the built-in services that are on, then any
 * service someone added. Adding "Visa" from the picker switches the planned
 * built-in Visa on (it keeps its translated label) rather than being hidden
 * behind it.
 */
export function serviceOptions(
  serviceTypes: readonly { key: string; name: string; active: boolean }[] = [],
): ServiceDefinition[] {
  const active = new Set(serviceTypes.filter((service) => service.active).map((service) => service.key));
  const builtIn = SERVICES.filter((service) => service.offered || active.has(service.key));
  const custom = serviceTypes
    .filter((service) => service.active && !BY_KEY.has(service.key as ServiceKey))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((service) => serviceDefinitionForKey(service.key, serviceTypes));
  return [...builtIn, ...custom];
}

/**
 * The stored key for a typed service name. Latin names keep a readable key
 * ("Visa" → VISA, so it lines up with the built-in); a name with no Latin
 * letters (翻訳, បកប្រែ) gets a stable generated key instead of being refused.
 */
export function serviceKeyFromName(name: string, now: number = Date.now()): string {
  const readable = name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (/^[A-Z][A-Z0-9_]{1,63}$/.test(readable)) return readable;
  return `SERVICE_${now.toString(36).toUpperCase()}`;
}

/** Rows written before `service_type` existed are read back from their type. */
const FROM_STORAGE_TYPE: Record<ItemType, ServiceKey> = {
  DESIGN: "DESIGN",
  PRINT: "PRINTING",
  RESIZE: "RESIZE",
  OTHER: "OTHER",
};

export function serviceForItem(
  item: Pick<BillingItem, "type"> & { serviceType?: string | null },
  serviceTypes: readonly { key: string; name: string; active: boolean }[] = [],
): ServiceDefinition {
  // Built-in keys are also seeded into the service_types table for picker
  // consistency. Resolve them first so they keep their pricing model.
  const builtIn = serviceByKey(item.serviceType);
  if (builtIn) return builtIn;
  const custom = item.serviceType && serviceTypes.find((entry) => entry.key === item.serviceType);
  if (custom) {
    return {
      key: custom.key,
      labelKey: "v2.service.OTHER",
      label: custom.name,
      storageType: item.type,
      pricing: "flat",
      offered: custom.active,
    };
  }
  return (
    serviceByKey(item.serviceType) ??
    serviceByKey(FROM_STORAGE_TYPE[item.type]) ??
    DEFAULT_SERVICE
  );
}

export function serviceLabel(
  service: ServiceDefinition,
  translate: (key: MessageKey) => string,
): string {
  return service.label ?? translate(service.labelKey);
}

export function isCostPriced(service: ServiceDefinition): boolean {
  return service.pricing === "cost";
}
