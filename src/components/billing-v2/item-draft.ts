"use client";

import { nextFinalPrice, printSellingPriceFromCost } from "@/lib/billing-v2/pricing";
import { evaluateMoneyExpression } from "@/lib/expr";
import {
  DEFAULT_SERVICE,
  isCostPriced,
  serviceDefinitionForKey,
  type ServiceDefinition,
  type ServiceKey,
} from "@/lib/billing-v2/services";
import type { BoardItem } from "@/lib/billing-v2/board";

type ServiceTypes = readonly { key: string; name: string; active: boolean }[];

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
    // A price that still equals its recommendation keeps following the cost.
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

export function draftService(draft: ItemDraft, serviceTypes: ServiceTypes = []): ServiceDefinition {
  return serviceDefinitionForKey(draft.serviceKey, serviceTypes) ?? DEFAULT_SERVICE;
}

/**
 * A blank field is "not entered yet", not zero. Also accepts a `+ - * / ()`
 * expression — `4.3*150` parses the same as a typed `645`.
 */
export function parseAmount(value: string): number | null {
  if (!value.trim()) return null;
  const result = evaluateMoneyExpression(value);
  return result.ok ? result.value : null;
}

/** Entered, but not a number the ledger can hold. */
function isInvalidAmount(value: string): boolean {
  return value.trim() !== "" && parseAmount(value) === null;
}

export function draftCost(draft: ItemDraft, serviceTypes: ServiceTypes = []): number | null {
  return isCostPriced(draftService(draft, serviceTypes)) ? parseAmount(draft.cost) : null;
}

export function draftRecommended(draft: ItemDraft, serviceTypes: ServiceTypes = []): number | null {
  const cost = draftCost(draft, serviceTypes);
  return cost == null ? null : printSellingPriceFromCost(cost);
}

export function draftFinal(draft: ItemDraft): number | null {
  return parseAmount(draft.finalPrice);
}

/** The cost changed: move the price with it unless a person set the price. */
export function withCost(draft: ItemDraft, cost: string, serviceTypes: ServiceTypes = []): ItemDraft {
  const next: ItemDraft = { ...draft, cost };
  const nextCost = draftCost(next, serviceTypes);
  if (nextCost == null) return next;
  const final = nextFinalPrice({
    cost: nextCost,
    manual: draft.priceTouched,
    currentFinal: draftFinal(draft) ?? 0,
  });
  return draft.priceTouched ? next : { ...next, finalPrice: String(final) };
}

export function draftTotal(drafts: ItemDraft[]): number {
  const total = drafts
    .filter((draft) => !draft.removed)
    .reduce((sum, draft) => sum + (draftFinal(draft) ?? 0), 0);
  return Math.round(total * 100) / 100;
}

export function draftPendingCount(drafts: ItemDraft[]): number {
  return drafts.filter((draft) => !draft.removed && draftFinal(draft) === null).length;
}

export type DraftField = "quantity" | "cost" | "finalPrice";

/** Fields holding something that cannot be saved, so they can be marked. */
export function draftErrors(draft: ItemDraft): Set<DraftField> {
  const errors = new Set<DraftField>();
  if (draft.removed) return errors;
  const quantity = parseAmount(draft.quantity);
  if (quantity == null || quantity <= 0) errors.add("quantity");
  if (isInvalidAmount(draft.cost)) errors.add("cost");
  if (isInvalidAmount(draft.finalPrice)) errors.add("finalPrice");
  return errors;
}

/**
 * A line can be saved when its numbers are real numbers. An empty final price
 * is an intentional "price pending", and an empty description falls back to
 * the service name — neither should stop a person from saving.
 */
export function draftIsComplete(draft: ItemDraft): boolean {
  return draftErrors(draft).size === 0;
}

/** Whether this line differs from what is stored. */
export function draftChanged(draft: ItemDraft): boolean {
  const before = draft.original;
  if (!before || draft.removed) return true;
  return (
    draft.serviceKey !== before.service.key ||
    draft.description.trim() !== before.item.description ||
    parseAmount(draft.quantity) !== before.item.quantity ||
    draftFinal(draft) !== before.amount ||
    (isCostPriced(before.service) && parseAmount(draft.cost) !== (before.item.printCost ?? null))
  );
}
