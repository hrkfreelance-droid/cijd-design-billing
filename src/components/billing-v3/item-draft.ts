"use client";

import { formatUnitCost, nextFinalPrice, printSellingPriceFromCost, roundCents } from "@/lib/billing-v2/pricing";
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

/** Which cost field a person is actually typing into right now. */
export type CostInputMode = "UNIT" | "TOTAL";

/**
 * One editable line in the project modal.
 *
 * The draft is the only thing the fields write to; nothing is sent until Save.
 * `priceTouched` is what makes a price the person's own — once it is set, a
 * cost edit refreshes the recommendation beside the price but leaves the price
 * where they put it.
 *
 * A printing line carries its cost two ways at once — Unit Cost and Total
 * Cost — because both are real quotes a print shop gives ("$4.30 each" or
 * "$30 for the lot"). `costMode` says which one is the source right now: it is
 * kept in sync from the other (Total = Qty × Unit), and a Quantity edit only
 * ever recomputes the field that *isn't* the source.
 */
export interface ItemDraft {
  /** Stable across re-renders, including for lines that have no id yet. */
  key: string;
  id: string | null;
  serviceKey: ServiceKey;
  description: string;
  quantity: string;
  costMode: CostInputMode;
  unitCost: string;
  totalCost: string;
  finalPrice: string;
  priceTouched: boolean;
  removed: boolean;
  original: BoardItem | null;
}

let sequence = 0;

export function draftFromItem(entry: BoardItem): ItemDraft {
  const quantity = entry.item.quantity;
  const totalCost = entry.item.printCost;
  return {
    key: entry.item.id,
    id: entry.item.id,
    serviceKey: entry.service.key,
    description: entry.item.description,
    quantity: String(quantity),
    // V3 input contract: Qty and Unit Cost are manual inputs.
    // Existing storage keeps total print cost, so derive Unit Cost once when
    // the editor opens. From then on Total Cost is always Qty × Unit Cost.
    costMode: "UNIT",
    totalCost: totalCost == null ? "" : String(totalCost),
    unitCost: totalCost == null || !quantity ? "" : formatUnitCost(totalCost / quantity),
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
    costMode: "UNIT",
    unitCost: "",
    totalCost: "",
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

export function draftQuantity(draft: ItemDraft): number | null {
  return parseAmount(draft.quantity);
}

/** V3 Total Cost is always Qty × Unit Cost. */
function rawTotalCost(draft: ItemDraft): number | null {
  const unit = parseAmount(draft.unitCost);
  const qty = draftQuantity(draft);
  return unit == null || qty == null || qty <= 0 ? null : roundCents(unit * qty);
}

/** Unit Cost is always the manually entered value in V3. */
function rawUnitCost(draft: ItemDraft): number | null {
  return parseAmount(draft.unitCost);
}

export function draftTotalCost(draft: ItemDraft, serviceTypes: ServiceTypes = []): number | null {
  return isCostPriced(draftService(draft, serviceTypes)) ? rawTotalCost(draft) : null;
}

export function draftUnitCost(draft: ItemDraft, serviceTypes: ServiceTypes = []): number | null {
  return isCostPriced(draftService(draft, serviceTypes)) ? rawUnitCost(draft) : null;
}

/** The pricing rule always reads Total Cost, never Unit Cost. */
export function draftRecommended(draft: ItemDraft, serviceTypes: ServiceTypes = []): number | null {
  const total = draftTotalCost(draft, serviceTypes);
  return total == null ? null : printSellingPriceFromCost(total);
}

export function draftFinal(draft: ItemDraft): number | null {
  return parseAmount(draft.finalPrice);
}

/**
 * V3 has two manual cost inputs: Quantity and Unit Cost.
 * Total Cost is derived only: Qty × Unit Cost.
 * Final Billing follows the recommendation until someone overrides it.
 */
function recomputeCost(draft: ItemDraft, serviceTypes: ServiceTypes): ItemDraft {
  let next = { ...draft, costMode: "UNIT" as const };
  if (isCostPriced(draftService(draft, serviceTypes))) {
    const qty = draftQuantity(next);
    const unit = parseAmount(next.unitCost);
    next = {
      ...next,
      totalCost: unit != null && qty != null && qty > 0 ? String(roundCents(unit * qty)) : "",
    };
  }
  const totalCost = rawTotalCost(next);
  if (totalCost == null) return next;
  const final = nextFinalPrice({
    cost: totalCost,
    manual: draft.priceTouched,
    currentFinal: draftFinal(draft) ?? 0,
  });
  return draft.priceTouched ? next : { ...next, finalPrice: String(final) };
}

export function withQuantity(draft: ItemDraft, quantity: string, serviceTypes: ServiceTypes = []): ItemDraft {
  return recomputeCost({ ...draft, quantity }, serviceTypes);
}

export function withUnitCost(draft: ItemDraft, unitCost: string, serviceTypes: ServiceTypes = []): ItemDraft {
  return recomputeCost({ ...draft, costMode: "UNIT", unitCost }, serviceTypes);
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
  if (isCostPriced(draftService(draft)) && isInvalidAmount(draft.unitCost)) errors.add("cost");
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
    draftQuantity(draft) !== before.item.quantity ||
    draftFinal(draft) !== before.amount ||
    (isCostPriced(before.service) && rawTotalCost(draft) !== (before.item.printCost ?? null))
  );
}
