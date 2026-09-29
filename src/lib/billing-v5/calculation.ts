/**
 * CIJD Billing V5 — the one calculation layer.
 *
 *   Cost → Pricing Rule → Recommended → (human decision) → Final
 *        → Final Total → Payments → Balance
 *        → Accounting: VAT → Grand Total USD → × NBC rate → Grand Total KHR
 *
 * Every screen and the server call these functions; none of them computes a
 * price, a balance or a tax figure on its own. Money is rounded in exactly
 * one way (`roundMoney`, half-up to the cent) and the tax figures are summed
 * in integer cents so the invoice always reconciles to the cent.
 *
 * The commercial layer (Final, payments, balance) and the accounting layer
 * (VAT, exchange rate) are separate: nothing here lets tax or a rate change a
 * Final price.
 *
 * Deliberately free of `@/` imports so it can be unit tested on its own.
 */
import {
  markupForCost,
  printMarkupFromCost,
  recommendedFromCost,
  roundCents,
} from "../billing-v2/pricing";

/* ------------------------------------------------------------------ money */

/** The single monetary rounding rule: half-up to the cent. */
export const roundMoney = roundCents;

/** Dollars → integer cents under the same rule. */
export function toCents(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

/* ---------------------------------------------------------- pricing rules */

/**
 * A named way of turning cost into a recommendation. New rules (for example
 * a quantity tier) are added here, by name, and never as UI behaviour.
 */
export interface PricingRule {
  id: string;
  /** Recommended line total for this total cost; `overridePercent` is a line's own markup. */
  recommend(costTotal: number, overridePercent: number | null, quantity: number): number;
  /** The markup the rule applies, as a fraction. */
  markup(costTotal: number, overridePercent: number | null, quantity: number): number;
}

/** Cost ≤ $50 → +50%, ≤ $100 → +40%, above → +30%; a line override wins. */
export const MARKUP_BAND_RULE: PricingRule = {
  id: "markup-band-v3",
  markup: (costTotal, overridePercent) => markupForCost(costTotal, overridePercent),
  recommend: (costTotal, overridePercent) => recommendedFromCost(costTotal, markupForCost(costTotal, overridePercent)),
};

export const PRICING_RULES: Readonly<Record<string, PricingRule>> = {
  [MARKUP_BAND_RULE.id]: MARKUP_BAND_RULE,
};

export const DEFAULT_PRICING_RULE = MARKUP_BAND_RULE;

export { printMarkupFromCost };

/* ------------------------------------------------------------- final mode */

export type FinalMode = "AUTO" | "MANUAL";

/**
 * The stored mode when there is one. Rows written before V5 stored it are read
 * the way V3 always read them — a Final that equals Recommended follows it —
 * so no existing price changes meaning (or value) on load.
 */
export function resolveFinalMode(input: {
  finalMode?: FinalMode | null;
  costPriced: boolean;
  amount: number | null;
  recommended: number | null;
}): FinalMode {
  if (input.finalMode === "AUTO" || input.finalMode === "MANUAL") return input.costPriced ? input.finalMode : "MANUAL";
  if (!input.costPriced) return "MANUAL";
  if (input.amount == null || input.recommended == null) return input.amount == null ? "AUTO" : "MANUAL";
  return input.amount === input.recommended ? "AUTO" : "MANUAL";
}

/** One priced line: what is typed, and what follows from it. */
export interface LineState {
  costPriced: boolean;
  quantity: number;
  /** Total cost (Qty × Unit Cost); null when unknown or not cost-priced. */
  costTotal: number | null;
  markupOverridePercent: number | null;
  finalMode: FinalMode;
  /** Final unit price; null while the price is pending. */
  finalUnit: number | null;
  /** Final line total; null while the price is pending. */
  finalTotal: number | null;
  ruleId?: string;
}

function rule(state: LineState): PricingRule {
  return (state.ruleId && PRICING_RULES[state.ruleId]) || DEFAULT_PRICING_RULE;
}

export function lineRecommended(state: LineState): number | null {
  if (!state.costPriced || state.costTotal == null) return null;
  return rule(state).recommend(state.costTotal, state.markupOverridePercent, state.quantity);
}

/** An AUTO line takes Recommended; a MANUAL line is returned untouched. */
function settle(state: LineState): LineState {
  if (state.finalMode !== "AUTO") return state;
  const recommended = lineRecommended(state);
  if (recommended == null) return state;
  return {
    ...state,
    finalTotal: recommended,
    finalUnit: state.quantity > 0 ? roundMoney(recommended / state.quantity) : null,
  };
}

/** Cost moved: Recommended recalculates; Final follows only when AUTO. */
export function changeCost(state: LineState, costTotal: number | null): LineState {
  return settle({ ...state, costTotal: costTotal == null ? null : roundMoney(costTotal) });
}

/** Markup moved (null = back to the band): same rule as a cost change. */
export function changeMarkup(state: LineState, overridePercent: number | null): LineState {
  return settle({ ...state, markupOverridePercent: overridePercent == null ? null : roundMoney(overridePercent) });
}

/**
 * Quantity moved. A MANUAL line keeps its Unit Final and its total becomes
 * unit × qty. An AUTO line's cost is Qty × Unit Cost, so its cost (and with it
 * the recommendation) scales and the Final follows.
 */
export function changeQuantity(state: LineState, quantity: number, unitCost: number | null = null): LineState {
  const next: LineState = { ...state, quantity };
  if (next.finalMode === "MANUAL") {
    return {
      ...next,
      finalTotal: next.finalUnit == null ? next.finalTotal : roundMoney(next.finalUnit * quantity),
    };
  }
  const costTotal = unitCost == null ? next.costTotal : roundMoney(unitCost * quantity);
  return settle({ ...next, costTotal });
}

/** A person typed a Final unit price: the line becomes MANUAL. */
export function setManualUnit(state: LineState, unit: number): LineState {
  const finalUnit = roundMoney(unit);
  return { ...state, finalMode: "MANUAL", finalUnit, finalTotal: roundMoney(finalUnit * state.quantity) };
}

/** A person typed a Final line total: the line becomes MANUAL. */
export function setManualTotal(state: LineState, total: number): LineState {
  const finalTotal = roundMoney(total);
  return {
    ...state,
    finalMode: "MANUAL",
    finalTotal,
    finalUnit: state.quantity > 0 ? roundMoney(finalTotal / state.quantity) : null,
  };
}

/** "Use recommended": Final = Recommended and the line follows it again. */
export function applyRecommended(state: LineState): LineState {
  return settle({ ...state, finalMode: "AUTO" });
}

/* ----------------------------------------------------- payments & balance */

export interface PaymentLike {
  amount: number;
  voidedAt?: string | null;
}

export type SettlementStatus = "UNPAID" | "PARTIALLY_PAID" | "PAID" | "OVERPAID";

export interface Settlement {
  finalTotal: number;
  paid: number;
  balance: number;
  overpaid: number;
  status: SettlementStatus;
}

/** Balance = Final Total − every payment that has not been voided. */
export function settlement(finalTotal: number, payments: readonly PaymentLike[]): Settlement {
  const totalCents = toCents(Math.max(finalTotal, 0));
  const paidCents = payments
    .filter((payment) => !payment.voidedAt && Number.isFinite(payment.amount) && payment.amount > 0)
    .reduce((sum, payment) => sum + toCents(payment.amount), 0);
  const balanceCents = Math.max(totalCents - paidCents, 0);
  const overCents = Math.max(paidCents - totalCents, 0);
  return {
    finalTotal: fromCents(totalCents),
    paid: fromCents(paidCents),
    balance: fromCents(balanceCents),
    overpaid: fromCents(overCents),
    status:
      paidCents === 0 ? "UNPAID" : overCents > 0 ? "OVERPAID" : balanceCents === 0 ? "PAID" : "PARTIALLY_PAID",
  };
}

/**
 * A project's payments, including a deposit stored the V3 way (a single
 * `depositAmount` on the project) as one DEPOSIT payment, so old and new
 * records go through the same balance calculation.
 */
export function projectPaymentsWithLegacyDeposit<P extends { projectId: string; amount: number; voidedAt?: string | null }>(
  project: { id: string; depositAmount?: number | null; date?: string },
  payments: readonly P[],
): (P | { id: string; projectId: string; kind: "DEPOSIT"; amount: number; paidOn: string; legacy: true; voidedAt: null })[] {
  const own = payments.filter((payment) => payment.projectId === project.id);
  const deposit = project.depositAmount;
  if (deposit == null || !Number.isFinite(deposit) || deposit <= 0) return own;
  return [
    {
      id: `legacy-deposit:${project.id}`,
      projectId: project.id,
      kind: "DEPOSIT",
      amount: roundMoney(deposit),
      paidOn: project.date ?? "",
      legacy: true,
      voidedAt: null,
    },
    ...own,
  ];
}

/* ------------------------------------------------------------- validation */

export type IssueLevel = "ERROR" | "WARNING";
export interface Issue {
  level: IssueLevel;
  code: string;
}

export function validateLine(input: {
  costPriced: boolean;
  quantity: number;
  costTotal: number | null;
  markupOverridePercent: number | null;
  finalMode: FinalMode;
  finalUnit: number | null;
  finalTotal: number | null;
}): Issue[] {
  const issues: Issue[] = [];
  const bad = (value: number | null) => value != null && !Number.isFinite(value);
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) issues.push({ level: "ERROR", code: "QUANTITY" });
  if (bad(input.costTotal) || (input.costTotal != null && input.costTotal < 0)) issues.push({ level: "ERROR", code: "COST" });
  if (
    input.markupOverridePercent != null &&
    (!Number.isFinite(input.markupOverridePercent) || input.markupOverridePercent < 0 || input.markupOverridePercent > 1000)
  ) {
    issues.push({ level: "ERROR", code: "MARKUP" });
  }
  if (bad(input.finalTotal) || (input.finalTotal != null && input.finalTotal < 0)) issues.push({ level: "ERROR", code: "FINAL" });
  if (bad(input.finalUnit) || (input.finalUnit != null && input.finalUnit < 0)) issues.push({ level: "ERROR", code: "FINAL_UNIT" });
  if (input.costPriced && input.finalMode === "AUTO" && input.costTotal == null) {
    issues.push({ level: "ERROR", code: "COST_REQUIRED_FOR_AUTO" });
  }
  // Intentional special pricing is allowed, but worth a second look.
  if (input.finalTotal === 0) issues.push({ level: "WARNING", code: "FINAL_ZERO" });
  if (
    input.finalUnit != null &&
    input.finalTotal != null &&
    Number.isFinite(input.quantity) &&
    input.quantity > 0 &&
    toCents(input.finalUnit * input.quantity) !== toCents(input.finalTotal)
  ) {
    issues.push({ level: "WARNING", code: "UNIT_TIMES_QTY_DIFFERS" });
  }
  if (input.costPriced && input.costTotal != null && input.finalTotal != null && input.finalTotal < input.costTotal) {
    issues.push({ level: "WARNING", code: "BELOW_COST" });
  }
  return issues;
}

export function validatePayment(amount: number, currentBalance: number): Issue[] {
  if (!Number.isFinite(amount) || amount <= 0) return [{ level: "ERROR", code: "PAYMENT_AMOUNT" }];
  if (toCents(amount) > toCents(currentBalance)) return [{ level: "WARNING", code: "PAYMENT_EXCEEDS_BALANCE" }];
  return [];
}

export function hasErrors(issues: readonly Issue[]): boolean {
  return issues.some((issue) => issue.level === "ERROR");
}

/* ---------------------------------------------------------------- tax */

export const VAT_PERCENT = 10;

export interface TaxInput {
  /** The designer's Final line amounts — used as they are, never recomputed. */
  lines: readonly { amount: number }[];
  vatApplicable: boolean;
  /** NBC USD/KHR, riel per dollar. */
  exchangeRate: number;
}

export interface TaxTotals {
  subtotalUsd: number;
  vatPercent: number;
  vatUsd: number;
  totalUsd: number;
  totalKhr: number;
}

/**
 * Subtotal = Σ Final line amounts; VAT = 10% of subtotal, half-up to the cent;
 * Grand Total USD = Subtotal + VAT; Grand Total KHR = USD × rate, half-up to
 * the riel. Same arithmetic as the V4 tax invoice, in integer cents.
 */
export function taxTotals(input: TaxInput): TaxTotals {
  const subtotalCents = input.lines.reduce((sum, line) => sum + toCents(line.amount), 0);
  const vatPercent = input.vatApplicable ? VAT_PERCENT : 0;
  const vatCents = Math.round((subtotalCents * vatPercent) / 100);
  const totalCents = subtotalCents + vatCents;
  const rateScaled = Math.round((input.exchangeRate + Number.EPSILON) * 10_000);
  // totalCents × rate / 100, computed exactly: rate is carried to 4 decimals.
  const khr = Number((BigInt(totalCents) * BigInt(rateScaled) + BigInt(500_000)) / BigInt(1_000_000));
  return {
    subtotalUsd: fromCents(subtotalCents),
    vatPercent,
    vatUsd: fromCents(vatCents),
    totalUsd: fromCents(totalCents),
    totalKhr: khr,
  };
}

/** The unit price printed for a line: stored unit when it reproduces the Final, else Final ÷ qty. */
export function invoiceUnitPrice(line: { quantity: number; unitPrice: number | null; amount: number }): number {
  if (!(line.quantity > 0)) return roundMoney(line.amount);
  const unit = line.unitPrice;
  if (unit != null && Number.isFinite(unit) && unit > 0 && toCents(unit * line.quantity) === toCents(line.amount)) {
    return roundMoney(unit);
  }
  return roundMoney(line.amount / line.quantity);
}

/* ------------------------------------------------------ invoice numbering */

/** CIJDTI + year + 3-digit sequence, as on the existing Excel tax invoices. */
export function formatTaxInvoiceNumber(year: number, sequence: number): string {
  return `CIJDTI${year}${String(sequence).padStart(3, "0")}`;
}

/** Paper invoices up to CIJDTI2026080 already exist; V4 reserves the same floor. */
export function invoiceSequenceFloor(year: number): number {
  return year === 2026 ? 81 : 1;
}

export function nextTaxInvoiceNumber(year: number, existing: readonly string[]): string {
  const prefix = `CIJDTI${year}`;
  let max = invoiceSequenceFloor(year) - 1;
  for (const number of existing) {
    if (!number.startsWith(prefix)) continue;
    const sequence = Number(number.slice(prefix.length));
    if (Number.isInteger(sequence) && sequence > max) max = sequence;
  }
  return formatTaxInvoiceNumber(year, max + 1);
}
