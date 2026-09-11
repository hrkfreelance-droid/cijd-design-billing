import assert from "node:assert/strict";
import { test } from "node:test";

import { itemBlocker, projectBlocker } from "../../src/lib/billing-v2/board.ts";
import { serviceByKey } from "../../src/lib/billing-v2/services.ts";

type Entry = Parameters<typeof itemBlocker>[0];

/** Just enough of a board item to exercise the readiness rule. */
function entry(overrides: Record<string, unknown> = {}, service = "DESIGN"): Entry {
  return {
    item: {
      amount: 25,
      productionStatus: "COMPLETED",
      billingStatus: "READY_TO_INVOICE",
      priceReviewStatus: "CONFIRMED",
      ...overrides,
    },
    service: serviceByKey(service)!,
    recommended: null,
    manual: false,
    amount: 25,
  } as unknown as Entry;
}

test("a priced, finished, ready line is billable", () => {
  assert.equal(itemBlocker(entry()), null);
});

test("an unset price is held back before anything else", () => {
  assert.equal(itemBlocker(entry({ amount: null })), "PRICE");
  assert.equal(itemBlocker(entry({ amount: null, productionStatus: "IN_PROGRESS" })), "PRICE");
});

test("an explicit zero price is billable when the other gates are clear", () => {
  assert.equal(itemBlocker(entry({ amount: 0 })), null);
});

test("unfinished production holds a line back", () => {
  assert.equal(itemBlocker(entry({ productionStatus: "IN_PROGRESS" })), "PRODUCTION");
});

test("bought-in work needs a confirmed price", () => {
  assert.equal(
    itemBlocker(entry({ productionStatus: "DELIVERED", priceReviewStatus: "REVIEW_REQUIRED" }, "PRINTING")),
    "PRINT_PRICE",
  );
  // Design carries no price review, so the same value does not block it.
  assert.equal(itemBlocker(entry({ priceReviewStatus: "REVIEW_REQUIRED" })), null);
});

test("a line still under review is not ready", () => {
  assert.equal(itemBlocker(entry({ billingStatus: "NEEDS_REVIEW" })), "REVIEW");
});

test("one unfinished line holds the whole project back", () => {
  const design = entry();
  const printing = entry({ productionStatus: "IN_PROGRESS" }, "PRINTING");
  const blocked = projectBlocker([design, printing]);
  assert.equal(blocked.blocker, "PRODUCTION");
  assert.equal(blocked.blockedBy, printing);

  assert.equal(projectBlocker([design, entry()]).blocker, null);
});
