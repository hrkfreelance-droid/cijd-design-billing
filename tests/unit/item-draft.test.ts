import assert from "node:assert/strict";
import { test } from "node:test";

import { blankDraft, draftIsComplete } from "../../src/components/billing-v2/item-draft.ts";

function draft(finalPrice: string) {
  return {
    ...blankDraft(),
    description: "Price pending line",
    finalPrice,
  };
}

test("a blank final price is saveable as NULL", () => {
  assert.equal(draftIsComplete(draft("")), true);
});

test("an explicit zero price is complete", () => {
  assert.equal(draftIsComplete(draft("0")), true);
});

test("an invalid entered price is not complete", () => {
  assert.equal(draftIsComplete(draft("-1")), false);
});
