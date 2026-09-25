"use client";

import {
  formatUnitCost,
  printMarkupFromCost,
  recommendedFromCost,
  roundCents,
} from "@/lib/billing-v2/pricing";
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
 * Where the final price comes from. There is exactly one source at a time,
 * so no field ever recalculates the field it was calculated from:
 *
 *   AUTO  — follows Recommended (cost × (1 + markup)); only cost-priced lines
 *   UNIT  — a Final Unit Price a person set; Total = Unit × Qty
 *   TOTAL — a Final Total a person typed; Unit = Total ÷ Qty
 *
 * UNIT and TOTAL are both manual overrides. A Quantity change on a manual
 * line keeps the unit price and recomputes the total — which makes the unit
 * price the source from then on. Nothing but an explicit "Use recommended"
 * returns a manual line to AUTO.
 */
export type FinalMode = "AUTO" | "UNIT" | "TOTAL";

/**
 * One editable line in the project modal.
 *
 * The draft is the only thing the fields write to; nothing is sent until Save.
 *
 * Pricing flows one way:
 *
 *   Qty × Unit Cost → Total Cost → Markup → Recommended → Final
 *
 * Recommended is always calculated and never stored as the final price by
 * itself; Final is what gets billed.
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
  /** Markup on cost in percent, as typed ("35" is +35%). */
  markup: string;
  /**
   * The markup is the line's own (typed now, or stored as its override);
   * otherwise it follows the cost band. Saved as `markupOverride`.
   */
  markupTouched: boolean;
  /** Final Total. Empty is "price pending", never $0. */
  finalPrice: string;
  /** Final Unit Price. Kept in step with `finalPrice` by `finalMode`. */
  finalUnitPrice: string;
  finalMode: FinalMode;
  removed: boolean;
  original: BoardItem | null;
}

let sequence = 0;

/** A calculated amount, as it is shown in a field. */
function moneyText(value: number): string {
  return roundCents(value).toFixed(2);
}

function percentText(fraction: number): string {
  const percent = Math.round(fraction * 1000) / 10;
  return Number.isInteger(percent) ? String(percent) : percent.toFixed(1);
}

export function draftFromItem(entry: BoardItem): ItemDraft {
  const quantity = entry.item.quantity;
  const totalCost = entry.item.printCost;
  const costPriced = isCostPriced(entry.service);
  const override = costPriced ? (entry.item.markupOverride ?? null) : null;
  const unitPrice = entry.finalUnitPrice ?? (entry.amount != null && quantity > 0 ? roundCents(entry.amount / quantity) : null);
  // A stored price that equals today's recommendation keeps following the
  // cost. Anything else is someone's price and opens as a manual unit price,
  // so a Quantity change keeps that unit price exactly as saved.
  const follows = costPriced && !entry.manual && (entry.amount == null || entry.amount === entry.recommended);
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
    markup:
      override != null ? percentText(override / 100) : totalCost == null ? "" : percentText(printMarkupFromCost(totalCost)),
    markupTouched: override != null,
    finalPrice: entry.amount == null ? "" : String(entry.amount),
    finalUnitPrice: unitPrice == null ? "" : String(unitPrice),
    finalMode: follows ? "AUTO" : "UNIT",
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
    markup: "",
    markupTouched: false,
    finalPrice: "",
    finalUnitPrice: "",
    finalMode: isCostPriced(serviceDefinitionForKey(serviceKey, []) ?? DEFAULT_SERVICE) ? "AUTO" : "UNIT",
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

function validQuantity(draft: ItemDraft): number | null {
  const qty = draftQuantity(draft);
  return qty != null && qty > 0 ? qty : null;
}

/** V3 Total Cost is always Qty × Unit Cost. */
function rawTotalCost(draft: ItemDraft): number | null {
  const unit = parseAmount(draft.unitCost);
  const qty = validQuantity(draft);
  return unit == null || qty == null ? null : roundCents(unit * qty);
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

/** The band markup for the current Total Cost, as a fraction; null without a cost. */
export function draftDefaultMarkup(draft: ItemDraft, serviceTypes: ServiceTypes = []): number | null {
  const total = draftTotalCost(draft, serviceTypes);
  return total == null ? null : printMarkupFromCost(total);
}

/** A typed markup that is not a percentage of zero or more. */
function isInvalidMarkup(value: string): boolean {
  if (!value.trim()) return false;
  const parsed = parseAmount(value);
  return parsed == null || parsed < 0;
}

/**
 * The markup actually used for Recommended, as a fraction: the person's own
 * when they typed one, otherwise the cost band.
 */
export function draftMarkup(draft: ItemDraft, serviceTypes: ServiceTypes = []): number | null {
  const fallback = draftDefaultMarkup(draft, serviceTypes);
  if (fallback == null) return null;
  if (!draft.markupTouched || isInvalidMarkup(draft.markup)) return fallback;
  const typed = parseAmount(draft.markup);
  return typed == null ? fallback : typed / 100;
}

/**
 * The markup to store as the line's override, in percent (35 for +35%), or
 * null for "use the default band".
 */
export function draftMarkupOverride(draft: ItemDraft, serviceTypes: ServiceTypes = []): number | null {
  if (!isCostPriced(draftService(draft, serviceTypes)) || !draft.markupTouched) return null;
  if (isInvalidMarkup(draft.markup)) return null;
  const typed = parseAmount(draft.markup);
  return typed == null ? null : roundCents(typed);
}

/** The pricing rule always reads Total Cost, never Unit Cost. */
export function draftRecommended(draft: ItemDraft, serviceTypes: ServiceTypes = []): number | null {
  const total = draftTotalCost(draft, serviceTypes);
  const markup = draftMarkup(draft, serviceTypes);
  return total == null || markup == null ? null : recommendedFromCost(total, markup);
}

/** Final Total — what is billed. */
export function draftFinal(draft: ItemDraft): number | null {
  const value = parseAmount(draft.finalPrice);
  return value == null ? null : roundCents(value);
}

/** Final Unit Price, to the cent. */
export function draftFinalUnit(draft: ItemDraft): number | null {
  const value = parseAmount(draft.finalUnitPrice);
  return value == null ? null : roundCents(value);
}

/** Final differs from Recommended because a person chose it. */
export function draftIsManual(draft: ItemDraft, serviceTypes: ServiceTypes = []): boolean {
  return isCostPriced(draftService(draft, serviceTypes)) && draft.finalMode !== "AUTO";
}

/**
 * Keeps the calculated side of the final price in step with its source.
 * Never touches the field the person is typing in.
 */
function settleFinal(draft: ItemDraft, serviceTypes: ServiceTypes): ItemDraft {
  const qty = validQuantity(draft);
  switch (draft.finalMode) {
    case "AUTO": {
      if (!isCostPriced(draftService(draft, serviceTypes))) return draft;
      const recommended = draftRecommended(draft, serviceTypes);
      // Without a cost there is nothing to follow; leave the price as it is.
      if (recommended == null) return draft;
      return {
        ...draft,
        finalPrice: moneyText(recommended),
        finalUnitPrice: qty == null ? "" : moneyText(recommended / qty),
      };
    }
    case "UNIT": {
      const unit = draftFinalUnit(draft);
      if (unit == null || qty == null) return draft.finalUnitPrice.trim() ? draft : { ...draft, finalPrice: "" };
      return { ...draft, finalPrice: moneyText(unit * qty) };
    }
    case "TOTAL": {
      const total = draftFinal(draft);
      if (total == null || qty == null) return draft.finalPrice.trim() ? draft : { ...draft, finalUnitPrice: "" };
      return { ...draft, finalUnitPrice: moneyText(total / qty) };
    }
  }
}

/**
 * Recommended moved (cost or markup). Only an AUTO Final follows it; a
 * manual Final is the person's price and stays exactly as it is — including
 * a stored total that is not unit × qty to the cent (e.g. $305.00 at
 * 170 × $1.79 = $304.30). Only the Final fields, a Quantity change and
 * "Use recommended" may move a manual Final.
 */
function followRecommendation(draft: ItemDraft, serviceTypes: ServiceTypes): ItemDraft {
  return draft.finalMode === "AUTO" ? settleFinal(draft, serviceTypes) : draft;
}

/**
 * Cost moved: Total Cost, the band markup and (for AUTO) Final follow it.
 * `quantityChanged` is the one case a manual Final is re-derived: its unit
 * price stays and its total becomes unit × the new quantity.
 */
function recomputeCost(draft: ItemDraft, serviceTypes: ServiceTypes, quantityChanged = false): ItemDraft {
  let next: ItemDraft = { ...draft, costMode: "UNIT" };
  if (isCostPriced(draftService(next, serviceTypes))) {
    const total = rawTotalCost(next);
    next = {
      ...next,
      totalCost: total == null ? "" : String(total),
      markup: next.markupTouched ? next.markup : total == null ? "" : percentText(printMarkupFromCost(total)),
    };
  }
  return quantityChanged ? settleFinal(next, serviceTypes) : followRecommendation(next, serviceTypes);
}

/**
 * Quantity is the one input both sides read. A manual price keeps its unit
 * price and recomputes its total — never the other way round.
 */
export function withQuantity(draft: ItemDraft, quantity: string, serviceTypes: ServiceTypes = []): ItemDraft {
  let next: ItemDraft = { ...draft, quantity };
  if (next.finalMode === "TOTAL" && draftFinalUnit(next) != null) next = { ...next, finalMode: "UNIT" };
  return recomputeCost(next, serviceTypes, true);
}

export function withUnitCost(draft: ItemDraft, unitCost: string, serviceTypes: ServiceTypes = []): ItemDraft {
  return recomputeCost({ ...draft, costMode: "UNIT", unitCost }, serviceTypes);
}

/** A typed markup: Recommended recalculates; a manual Final stays where it is. */
export function withMarkup(draft: ItemDraft, markup: string, serviceTypes: ServiceTypes = []): ItemDraft {
  return followRecommendation({ ...draft, markup, markupTouched: true }, serviceTypes);
}

/** Back to the markup band for the current cost. */
export function withDefaultMarkup(draft: ItemDraft, serviceTypes: ServiceTypes = []): ItemDraft {
  const fallback = draftDefaultMarkup(draft, serviceTypes);
  return followRecommendation(
    { ...draft, markup: fallback == null ? "" : percentText(fallback), markupTouched: false },
    serviceTypes,
  );
}

/** A typed Final Unit Price. Total = Unit × Qty. */
export function withFinalUnit(draft: ItemDraft, unitPrice: string, serviceTypes: ServiceTypes = []): ItemDraft {
  return settleFinal({ ...draft, finalUnitPrice: unitPrice, finalMode: "UNIT" }, serviceTypes);
}

/** A typed Final Total. Unit = Total ÷ Qty; Recommended is left alone. */
export function withFinalTotal(draft: ItemDraft, total: string, serviceTypes: ServiceTypes = []): ItemDraft {
  return settleFinal({ ...draft, finalPrice: total, finalMode: "TOTAL" }, serviceTypes);
}

/** The explicit way back: Final follows Recommended again. */
export function withRecommended(draft: ItemDraft, serviceTypes: ServiceTypes = []): ItemDraft {
  return settleFinal({ ...draft, finalMode: "AUTO" }, serviceTypes);
}

/** A new service: a cost-priced one starts following its recommendation. */
export function withService(draft: ItemDraft, serviceKey: ServiceKey, serviceTypes: ServiceTypes = []): ItemDraft {
  let next: ItemDraft = { ...draft, serviceKey };
  if (!isCostPriced(draftService(next, serviceTypes))) {
    next = { ...next, unitCost: "", totalCost: "", markup: "", markupTouched: false };
    if (next.finalMode === "AUTO") next = { ...next, finalMode: "UNIT" };
    return next;
  }
  return recomputeCost(next, serviceTypes);
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

export type DraftField = "quantity" | "cost" | "markup" | "finalUnit" | "finalPrice";

/** Fields holding something that cannot be saved, so they can be marked. */
export function draftErrors(draft: ItemDraft, serviceTypes: ServiceTypes = []): Set<DraftField> {
  const errors = new Set<DraftField>();
  if (draft.removed) return errors;
  const quantity = parseAmount(draft.quantity);
  if (quantity == null || quantity <= 0) errors.add("quantity");
  const costPriced = isCostPriced(draftService(draft, serviceTypes));
  if (costPriced && isInvalidAmount(draft.unitCost)) errors.add("cost");
  if (costPriced && draft.markupTouched && isInvalidMarkup(draft.markup)) errors.add("markup");
  const unit = parseAmount(draft.finalUnitPrice);
  if (isInvalidAmount(draft.finalUnitPrice) || (unit != null && unit < 0)) errors.add("finalUnit");
  const final = parseAmount(draft.finalPrice);
  if (isInvalidAmount(draft.finalPrice) || (final != null && final < 0)) errors.add("finalPrice");
  return errors;
}

/**
 * A line can be saved when its numbers are real numbers. An empty final price
 * is an intentional "price pending", and an empty description falls back to
 * the service name — neither should stop a person from saving.
 */
export function draftIsComplete(draft: ItemDraft, serviceTypes: ServiceTypes = []): boolean {
  return draftErrors(draft, serviceTypes).size === 0;
}

/** Whether this line differs from what is stored. */
export function draftChanged(draft: ItemDraft): boolean {
  const before = draft.original;
  if (!before || draft.removed) return true;
  const final = draftFinal(draft);
  return (
    draft.serviceKey !== before.service.key ||
    draft.description.trim() !== before.item.description ||
    draftQuantity(draft) !== before.item.quantity ||
    final !== before.amount ||
    (final != null && draft.finalMode !== "AUTO" && draftFinalUnit(draft) !== before.finalUnitPrice) ||
    (isCostPriced(before.service) && rawTotalCost(draft) !== (before.item.printCost ?? null)) ||
    (isCostPriced(before.service) && draftMarkupOverride(draft) !== (before.item.markupOverride ?? null))
  );
}
