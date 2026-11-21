import { serviceForItem } from "../billing-v2/services";
import type { ServiceFormat, Snapshot } from "../types";
import { matchesSearch, normalizeSearch, pricingCustomerCandidates, pricingCustomerIds, type ProjectView } from "./project-view";
import { priceEstimateFor, type PriceEstimate } from "./service-price-estimates";

export interface ServiceRecord {
  id: string;
  customerId: string;
  customer: string;
  projectId: string;
  date: string;
  description: string;
  serviceKey: string;
  quantity: number;
  unit: string;
  price: number | null;
}

export interface ServiceSuggestion {
  id: string;
  name: string;
  description: string;
  serviceKey: string;
  quantity: number;
  unit: string;
  price: number | null;
  source: "customer" | "format" | "history";
  group?: "customer" | "formats" | "history";
  date: string | null;
  count: number;
  customer?: string;
  formatId?: string;
  /** Identity of the exact historical product, for co-order lookup. */
  productKey?: string;
  estimate?: PriceEstimate;
}

export interface SuggestionIndex {
  records: ServiceRecord[];
  byCustomer: Map<string, ServiceRecord[]>;
  byProject: Map<string, ServiceRecord[]>;
  formats: ServiceFormat[];
  aliases: ReturnType<typeof pricingCustomerCandidates>;
  /** Derived lists are reused across rows and searches; replaced with each snapshot. */
  cache: Map<string, ServiceSuggestion[]>;
}

const families = [
  ["flyer", "Flyer", /flyers?|fliers?|leaflets?|フライヤー|チラシ|ខិត្តប័ណ្ណ/iu],
  ["voucher", "Voucher", /vouchers?|coupons?|バウチャー|クーポン|ប័ណ្ណបញ្ចុះតម្លៃ/iu],
  ["pop", "POP", /\bpop\b|ポップ/iu],
  ["board", "Board", /boards?|panel|ボード|パネル|ក្តារ/iu],
  ["sticker", "Sticker", /stickers?|labels?|ステッカー|シール|ស្ទីកឃ័រ/iu],
  ["menu", "Menu", /menus?|メニュー|បញ្ជីមុខម្ហូប/iu],
  ["business-card", "Business card", /business\s*cards?|name\s*cards?|名刺|នាមប័ណ្ណ/iu],
  ["banner", "Banner", /banners?|バナー|បដា/iu],
  ["brochure", "Brochure", /brochures?|booklets?|パンフレット|冊子/iu],
] as const;

/** Spaces, punctuation and full-width letters vary in imports; sizes and numbers remain distinct. */
export const productNameKey = (text: string) => normalizeSearch(text).replace(/[^\p{L}\p{M}\p{N}]/gu, "");
const unitKey = (unit: string) => {
  const key = productNameKey(unit);
  return /^(pcs?|pieces?)$/.test(key) ? "pcs" : key;
};
export const serviceProductKey = (row: Pick<ServiceRecord, "serviceKey" | "description" | "unit">) =>
  `${row.serviceKey}|${unitKey(row.unit)}|${productNameKey(row.description)}`;

function formatIdentity(description: string, serviceKey: string, unit: string) {
  const normalized = normalizeSearch(description);
  const size = normalized.match(/\ba\s*([345])\b/i)?.[1];
  const family = families.find(([, , pattern]) => pattern.test(normalized));
  const kind = family?.[0] ?? (size ? `a${size}` : /print|印刷|បោះពុម្ព/iu.test(normalized) ? "print" : null);
  if (!kind) return null;
  const name = [family?.[1], size ? `A${size}` : null].filter(Boolean).join(" ") || "Print";
  return { id: `format:${kind}${family && size ? `-a${size}` : ""}:${serviceKey}:${unitKey(unit)}`, name };
}

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return Math.round((sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2) * 100) / 100;
};

function common<T>(values: T[], fallback: T): T {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback;
}

function add<T>(map: Map<string, T[]>, key: string, value: T) {
  const rows = map.get(key);
  if (rows) rows.push(value);
  else map.set(key, [value]);
}

/** Pure and read-only. Called once per snapshot by the workspace provider, never per editor row. */
export function buildSuggestionIndex(snapshot: Snapshot, views: ProjectView[]): SuggestionIndex {
  const records: ServiceRecord[] = [];
  const seen = new Set<string>();
  const itemLookup = new Map(snapshot.billingItems.map((item) => [item.id, item]));
  const customerNames = new Map(views.map((view) => [view.project.clientId, view.client]));
  for (const view of views) {
    for (const { item, price, unit } of view.items) {
      if (item.deletedAt || !item.description.trim() || seen.has(item.id)) continue;
      seen.add(item.id);
      records.push({
        id: item.id, customerId: view.project.clientId, customer: view.client,
        projectId: view.project.id, date: item.historicalMonth || view.project.date,
        description: item.description.trim(), serviceKey: serviceForItem(item, snapshot.serviceTypes).key,
        quantity: item.quantity > 0 ? item.quantity : 1, unit: item.unit || unit || "",
        price: price != null && Number.isFinite(price) && price >= 0 ? price : null,
      });
    }
  }
  // Invoice-only lines also belong to the history. Advance/remainder lines are
  // payments, not product unit prices: only the original contract is usable.
  for (const invoice of [...(snapshot.taxInvoices ?? [])].sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate))) {
    if (invoice.status !== "ISSUED") continue;
    const lines = invoice.contractSnapshot?.lines ??
      (!invoice.invoiceKind || invoice.invoiceKind === "FULL" ? invoice.lines : []);
    lines.forEach((line, n) => {
      if (line.billingItemId && seen.has(line.billingItemId)) return;
      const id = line.billingItemId || `invoice:${invoice.id}:${n}`;
      if (seen.has(id) || !line.description.trim()) return;
      seen.add(id);
      const linked = line.billingItemId ? itemLookup.get(line.billingItemId) : undefined;
      if (linked?.deletedAt) return;
      const serviceKey = linked ? serviceForItem(linked, snapshot.serviceTypes).key :
        /design|artwork|デザイン|រចនា/iu.test(line.description) ? "DESIGN" :
          /print|印刷|បោះពុម្ព/iu.test(line.description) ? "PRINTING" : "OTHER";
      records.push({ id, customerId: invoice.clientId, customer: customerNames.get(invoice.clientId) || invoice.customer.companyNameEn,
        projectId: linked?.projectId || invoice.projectId || `invoice:${invoice.id}`, date: invoice.invoiceDate,
        description: line.description.trim(), serviceKey, quantity: line.quantity > 0 ? line.quantity : 1,
        unit: line.unit || "", price: Number.isFinite(line.unitPrice) && line.unitPrice >= 0 ? line.unitPrice : null });
    });
  }
  records.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const byCustomer = new Map<string, ServiceRecord[]>(), byProject = new Map<string, ServiceRecord[]>();
  const groups = new Map<string, { name: string; rows: ServiceRecord[] }>();
  for (const row of records) {
    add(byCustomer, row.customerId, row);
    add(byProject, row.projectId, row);
    const identity = formatIdentity(row.description, row.serviceKey, row.unit);
    if (!identity) continue;
    const group = groups.get(identity.id) ?? { name: identity.name, rows: [] };
    group.rows.push(row);
    groups.set(identity.id, group);
  }
  const formats = new Map<string, ServiceFormat>();
  for (const [id, { name, rows }] of groups) {
    formats.set(id, { id, name, description: common(rows.map((row) => row.description), name),
      serviceKey: rows[0].serviceKey, unit: rows[0].unit, quantity: common(rows.map((row) => row.quantity), 1),
      defaultUnitPrice: median(rows.flatMap((row) => row.price == null ? [] : [row.price])), active: true,
      sampleCount: rows.length });
  }
  // Empty/new workspaces still offer the owner's familiar formats, with no invented prices.
  for (const [kind, name] of [...families.map(([key, label]) => [key, label]), ["a3", "A3"], ["a4", "A4"], ["a5", "A5"], ["print", "Print"]]) {
    for (const serviceKey of kind === "print" ? ["PRINTING"] : ["DESIGN", "PRINTING"]) {
      if ([...formats.keys()].some((id) => id.startsWith(`format:${kind}:` ) && id.includes(`:${serviceKey}:`))) continue;
      const id = `format:${kind}:${serviceKey}:`;
      formats.set(id, { id, name, description: `${name} ${serviceKey === "DESIGN" ? "Design" : "Print"}`,
        serviceKey, unit: "", quantity: 1, defaultUnitPrice: null, active: true, sampleCount: 0 });
    }
  }
  // Edits are separate from billing facts. Unedited formats keep following history.
  for (const format of snapshot.serviceFormats ?? []) formats.set(format.id, format);
  return { records, byCustomer, byProject, formats: [...formats.values()].sort((a, b) => a.name.localeCompare(b.name) || a.serviceKey.localeCompare(b.serviceKey)),
    aliases: pricingCustomerCandidates(snapshot.clients, views), cache: new Map() };
}

function aggregate(rows: ServiceRecord[], source: "customer" | "history"): ServiceSuggestion[] {
  const groups = new Map<string, ServiceRecord[]>();
  for (const row of rows) add(groups, serviceProductKey(row), row);
  return [...groups].map(([key, entries]) => {
    const latest = entries[0];
    const priced = entries.find((entry) => entry.price !== null);
    return { id: `${source}:${key}`, name: latest.description, description: latest.description,
      serviceKey: latest.serviceKey, quantity: latest.quantity, unit: latest.unit,
      price: priced?.price ?? null, source, date: priced?.date ?? latest.date,
      count: new Set(entries.map((entry) => entry.projectId)).size, customer: latest.customer, productKey: key };
  }).sort((a, b) => b.count - a.count || (b.date ?? "").localeCompare(a.date ?? "") || a.name.localeCompare(b.name));
}

function referenceFor(formats: ServiceFormat[], row: Pick<ServiceRecord, "description" | "serviceKey" | "unit">) {
  const identity = formatIdentity(row.description, row.serviceKey, row.unit);
  return formats.find((format) => format.active && format.serviceKey === row.serviceKey && unitKey(format.unit) === unitKey(row.unit)
    && (format.id === identity?.id || productNameKey(format.description) === productNameKey(row.description)));
}

/** No cap: every past product remains reachable by scrolling/searching. */
export function suggestionsFor(index: SuggestionIndex, customerId: string, projectId = "", query = ""): ServiceSuggestion[] {
  const cacheKey = JSON.stringify([customerId, projectId]);
  const cached = index.cache.get(cacheKey);
  if (cached) return filterSuggestions(cached, query);
  const customerIds = pricingCustomerIds(customerId, index.aliases);
  const own = [...customerIds].flatMap((id) => index.byCustomer.get(id) ?? [])
    .filter((row) => row.projectId !== projectId).sort((a, b) => b.date.localeCompare(a.date));
  const customer = aggregate(own, "customer").map((row) => {
    const fallback = referenceFor(index.formats, row);
    const estimate = row.price === null && (!fallback?.updatedAt || fallback.defaultUnitPrice === null) ? priceEstimateFor(index, { ...row, projectId }) : null;
    return { ...row, group: "customer" as const,
      ...(row.price === null && fallback?.defaultUnitPrice != null ? { price: fallback.defaultUnitPrice, source: "format" as const, date: null } : {}),
      ...(estimate ? { price: estimate.price, source: fallback ? "format" as const : "history" as const, date: null, estimate } : {}) };
  });
  const formats: ServiceSuggestion[] = index.formats.filter((format) => format.active).map((format) => {
    const exact = customer.find((row) => row.productKey === serviceProductKey({ description: format.description, serviceKey: format.serviceKey, unit: format.unit }));
    const previous = exact?.source === "customer" ? exact : undefined;
    const estimate = !previous && (!format.updatedAt || format.defaultUnitPrice === null) ? priceEstimateFor(index, { ...format, projectId }) : null;
    return { id: format.id, name: format.name, description: format.description, quantity: format.quantity,
      serviceKey: format.serviceKey, unit: format.unit, price: previous?.price ?? (format.updatedAt ? format.defaultUnitPrice : null) ?? estimate?.price ?? format.defaultUnitPrice,
      source: previous?.price != null ? "customer" : "format", date: previous?.price != null ? previous.date : null,
      ...(estimate ? { estimate } : {}),
      count: format.sampleCount ?? 0, formatId: format.id,
      productKey: serviceProductKey({ description: format.description, serviceKey: format.serviceKey, unit: format.unit }) };
  });
  const owned = new Set(customer.map((row) => row.productKey));
  const others = aggregate(index.records.filter((row) => row.projectId !== projectId), "history")
    .filter((row) => !owned.has(row.productKey)).map((row) => {
      const format = referenceFor(index.formats, row);
      // Another customer's exact price is not this customer's agreed price.
      const editedFormat = Boolean(format?.updatedAt && format.defaultUnitPrice !== null);
      if (editedFormat) return { ...row, price: format!.defaultUnitPrice, date: null };
      // Search/filtering must not estimate every historical product eagerly.
      // Compute the reference only when a visible option or selection reads it.
      let estimate: PriceEstimate | null | undefined;
      const reference = () => {
        if (estimate === undefined) estimate = priceEstimateFor(index, { ...row, projectId });
        return estimate;
      };
      return { ...row, date: null,
        get price() { return reference()?.price ?? format?.defaultUnitPrice ?? null; },
        get estimate() { return reference() ?? undefined; } };
    });
  const all = [...customer, ...formats, ...others];
  if (index.cache.size >= 16) index.cache.delete(index.cache.keys().next().value!);
  index.cache.set(cacheKey, all);
  return filterSuggestions(all, query);
}

function filterSuggestions(rows: ServiceSuggestion[], query: string) {
  return rows.filter((row) => (query.trim() || row.source !== "history" || row.group === "customer") && matchesSearch(normalizeSearch(`${row.name} ${row.description} ${row.unit} ${row.customer || ""} ${row.serviceKey}`), query));
}

/** One observed companion, ranked by co-orders for this customer first. */
export function companionFor(index: SuggestionIndex, picked: ServiceSuggestion, customerId: string, projectId: string, existing: ReadonlySet<string>): ServiceSuggestion | null {
  if (!picked.productKey) return null;
  const ids = pricingCustomerIds(customerId, index.aliases);
  const scores = new Map<string, { row: ServiceRecord; score: number }>();
  const projects = new Set(index.records.filter((row) => serviceProductKey(row) === picked.productKey && row.projectId !== projectId).map((row) => row.projectId));
  for (const id of projects) {
    const counted = new Set<string>();
    for (const row of index.byProject.get(id) ?? []) {
      const key = serviceProductKey(row);
      if (key === picked.productKey || existing.has(key) || counted.has(key) || row.serviceKey === picked.serviceKey) continue;
      counted.add(key);
      const previous = scores.get(key);
      scores.set(key, { row: previous?.row ?? row, score: (previous?.score ?? 0) + (ids.has(row.customerId) ? 10 : 1) });
    }
  }
  const best = [...scores].sort((a, b) => b[1].score - a[1].score || b[1].row.date.localeCompare(a[1].row.date))[0];
  if (!best) return null;
  const own = suggestionsFor(index, customerId, projectId).find((row) => row.productKey === best[0]);
  if (own) return own;
  return suggestionsFor(index, customerId, projectId, best[1].row.description).find((row) => row.productKey === best[0]) ?? null;
}
