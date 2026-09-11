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
    // Every printCost on record was always a total, never a per-unit price —
    // keep reading it that way. Unit Cost starts as a derived display only;
    // it becomes the source the moment someone types into it.
    costMode: "TOTAL",
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

/** Total cost, computed the same way no matter which field is the source. */
function rawTotalCost(draft: ItemDraft): number | null {
  if (draft.costMode === "TOTAL") return parseAmount(draft.totalCost);
  const unit = parseAmount(draft.unitCost);
  const qty = draftQuantity(draft);
  return unit == null || qty == null || qty <= 0 ? null : roundCents(unit * qty);
}

/** Unit cost, computed the same way no matter which field is the source. */
function rawUnitCost(draft: ItemDraft): number | null {
  if (draft.costMode === "UNIT") return parseAmount(draft.unitCost);
  const total = parseAmount(draft.totalCost);
  const qty = draftQuantity(draft);
  return total == null || qty == null || qty <= 0 ? null : total / qty;
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
 * Refreshes whichever cost field is not the source, and moves Final Billing
 * with the new Total Cost unless a person set the price by hand.
 */
function recomputeCost(draft: ItemDraft, serviceTypes: ServiceTypes): ItemDraft {
  let next = draft;
  if (isCostPriced(draftService(draft, serviceTypes))) {
    const qty = draftQuantity(draft);
    if (draft.costMode === "UNIT") {
      const unit = parseAmount(draft.unitCost);
      if (unit != null && qty != null && qty > 0) {
        next = { ...draft, totalCost: String(roundCents(unit * qty)) };
      }
    } else {
      const total = parseAmount(draft.totalCost);
      if (total != null && qty != null && qty > 0) {
        next = { ...draft, unitCost: formatUnitCost(total / qty) };
      }
    }
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

/**
 * A Quantity edit recomputes only the field that isn't the source: in UNIT
 * mode Total Cost follows Qty × Unit; in TOTAL mode Total Cost holds still
 * and Unit Cost is what moves.
 */
export function withQuantity(draft: ItemDraft, quantity: string, serviceTypes: ServiceTypes = []): ItemDraft {
  return recomputeCost({ ...draft, quantity }, serviceTypes);
}

/** Unit Cost changed by hand: it becomes the source, Total Cost follows it. */
export function withUnitCost(draft: ItemDraft, unitCost: string, serviceTypes: ServiceTypes = []): ItemDraft {
  return recomputeCost({ ...draft, costMode: "UNIT", unitCost }, serviceTypes);
}

/** Total Cost changed by hand: it becomes the source, Unit Cost follows it. */
export function withTotalCost(draft: ItemDraft, totalCost: string, serviceTypes: ServiceTypes = []): ItemDraft {
  return recomputeCost({ ...draft, costMode: "TOTAL", totalCost }, serviceTypes);
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
  const costText = draft.costMode === "UNIT" ? draft.unitCost : draft.totalCost;
  if (isInvalidAmount(costText)) errors.add("cost");
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
