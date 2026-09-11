import assert from "node:assert/strict";
import { test } from "node:test";

import {
  OFFERED_SERVICES,
  isCostPriced,
  serviceByKey,
  serviceForItem,
} from "../../src/lib/billing-v2/services.ts";

test("design and printing are what the app offers today", () => {
  const offered = OFFERED_SERVICES.map((service) => service.key);
  assert.ok(offered.includes("DESIGN"));
  assert.ok(offered.includes("PRINTING"));
});

test("only printing is priced from a cost", () => {
  assert.equal(isCostPriced(serviceByKey("PRINTING")!), true);
  assert.equal(isCostPriced(serviceByKey("DESIGN")!), false);
});

test("a row written before service_type existed still names its service", () => {
  assert.equal(serviceForItem({ type: "PRINT" }).key, "PRINTING");
  assert.equal(serviceForItem({ type: "DESIGN" }).key, "DESIGN");
  assert.equal(serviceForItem({ type: "RESIZE" }).key, "RESIZE");
  assert.equal(serviceForItem({ type: "OTHER" }).key, "OTHER");
});

test("an explicit service_type wins over the storage type", () => {
  assert.equal(serviceForItem({ type: "OTHER", serviceType: "TRANSLATION" }).key, "TRANSLATION");
});

test("an unknown service falls back rather than breaking the row", () => {
  assert.equal(serviceForItem({ type: "DESIGN", serviceType: "NOT_A_SERVICE" }).key, "DESIGN");
});
