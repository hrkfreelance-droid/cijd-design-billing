"use client";

import { printSellingPriceFromCost } from "@/lib/billing-v2/pricing";
import {
  DEFAULT_SERVICE,
  isCostPriced,
  serviceDefinitionForKey,
  type ServiceDefinition,
  type ServiceKey,
} from "@/lib/billing-v2/services";
import type { BoardItem } from "@/lib/billing-v2/board";

/**
 * One editable line in the project modal.
 *
 * The draft is the only thing the fields write to; nothing is sent until Save.
 * `priceTouched` is what makes a price the person's own — once it is set, a
 * cost edit refreshes the recommendation beside the price but leaves the price
 * where they put it.
 */
export interface ItemDraft {
  /** Stable across re-renders, including for lines that have no id yet. */
  key: string;
  id: string | null;
  serviceKey: ServiceKey;
  description: string;
  quantity: string;
  cost: string;
  finalPrice: string;
  priceTouched: boolean;
  removed: boolean;
  original: BoardItem | null;
}

let sequence = 0;

export function draftFromItem(entry: BoardItem): ItemDraft {
  return {
    key: entry.item.id,
    id: entry.item.id,
    serviceKey: entry.service.key,
    description: entry.item.description,
    quantity: String(entry.item.quantity),
    cost: entry.item.printCost == null ? "" : String(entry.item.printCost),
    finalPrice: entry.amount == null ? "" : String(entry.amount),
    priceTouched: entry.manual,
    removed: false,
    original: entry,
  };
}

export function blankDraft(serviceKey: ServiceKey = DEFAULT_SERVICE.key): ItemDraft {
  sequence += 1;
  return {
    key: `new-${sequence}`,
    id: null,
    serviceKey,
    description: "",
    quantity: "1",
    cost: "",
    finalPrice: "",
    priceTouched: false,
    removed: false,
    original: null,
  };
}

export function draftService(
  draft: ItemDraft,
  serviceTypes: readonly { key: string; name: string; active: boolean }[] = [],
): ServiceDefinition {
  return serviceDefinitionForKey(draft.serviceKey, serviceTypes) ?? DEFAULT_SERVICE;
}

/** A blank field is "not entered yet", not zero. */
export function parseAmount(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function draftCost(
  draft: ItemDraft,
  serviceTypes: readonly { key: string; name: string; active: boolean }[] = [],
): number | null {
  return isCostPriced(draftService(draft, serviceTypes)) ? parseAmount(draft.cost) : null;
}

export function draftRecommended(
  draft: ItemDraft,
  serviceTypes: readonly { key: string; name: string; active: boolean }[] = [],
): number | null {
  const cost = draftCost(draft, serviceTypes);
  return cost == null ? null : printSellingPriceFromCost(cost);
}

export function draftFinal(draft: ItemDraft): number | null {
  return parseAmount(draft.finalPrice);
}

export function draftTotal(drafts: ItemDraft[]): number {
  const total = drafts
    .filter((draft) => !draft.removed)
    .reduce((sum, draft) => sum + (draftFinal(draft) ?? 0), 0);
  return Math.round(total * 100) / 100;
}

/** A line is ready to save when it says what it is and what it costs. */
export function draftIsComplete(draft: ItemDraft): boolean {
  if (draft.removed) return true;
  if (!draft.description.trim()) return false;
  const quantity = parseAmount(draft.quantity);
  if (quantity == null || quantity <= 0) return false;
  const final = draftFinal(draft);
  // An empty final price is an intentional NULL and can be saved for later.
  return !draft.finalPrice.trim() || final != null;
}
