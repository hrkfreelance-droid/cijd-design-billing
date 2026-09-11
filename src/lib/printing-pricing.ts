/**
 * Printing cost is a total cost; the selling price is a separate billing fact.
 *
 * The rule itself lives in `@/lib/billing-v2/pricing` so V1 and V2 can never
 * drift apart. This module stays as the name the existing callers import.
 */
export { printMarginFromCost, printSellingPriceFromCost } from "@/lib/billing-v2/pricing";
