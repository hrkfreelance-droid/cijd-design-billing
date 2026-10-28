import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizedTin, parseCambodianPatent } from "../../src/lib/billing-v5/patent-import.ts";

test("Patent Tax PDF text: legal name, TIN, owner and year extracted without inventing address", () => {
  const extracted = [
    "ប័ណ្ណពន្ធប៉ាតង់ ឆ្នាំ ២០២៦",
    "PATENT TAX 2026",
    "Medium Taxpayer",
    "Enterprise's name : EXAMPLE ADVERTISING CO., LTD.",
    "Tax Identification Number (TIN) : K007-123456789",
    "Registered at : General Department of Taxation Under : Mean Chey Tax Branch",
    "Main business activity(ies) : Advertising service",
    "Owner's name : TEST OWNER Nationality : Cambodian",
    "Phnom Penh, 03 March 2026",
  ].join("\n");
  const result = parseCambodianPatent(extracted);
  assert.equal(result.enterpriseName, "EXAMPLE ADVERTISING CO., LTD.");
  assert.equal(result.tin, "K007-123456789");
  assert.equal(result.patentYear, "2026");
  assert.equal(result.ownerName, "TEST OWNER");
  assert.equal(result.addressKm, "");
});

test("Duplicate Tax ID comparison accepts spacing, punctuation and case variants", () => {
  assert.equal(normalizedTin("k007-123456789"), normalizedTin("K007 123456789"));
  assert.equal(normalizedTin(""), "");
});

test("Scanned or unrelated text does not fabricate customer data", () => {
  const parsed = parseCambodianPatent("Invoice PDF without legal identifiers");
  assert.equal(parsed.enterpriseName, "");
  assert.equal(parsed.tin, "");
  assert.equal(parsed.ownerName, "");
});
