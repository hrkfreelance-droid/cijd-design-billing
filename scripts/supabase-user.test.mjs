import assert from "node:assert/strict";
import { test } from "node:test";

import { parseArgs, passwordPolicyProblem, validateArgs } from "./supabase-user.mjs";

test("provisioning arguments require a role and email but never accept passwords", () => {
  const args = parseArgs(["--email", "staff@example.com", "--role", "billing", "--name", "Billing"]);
  validateArgs(args);
  assert.equal(args.role, "BILLING");
  assert.equal(args.name, "Billing");
  const printing = parseArgs(["--email", "print@example.com", "--role", "printing"]);
  validateArgs(printing);
  assert.equal(printing.role, "PRINTING");
  assert.throws(() => parseArgs(["--email", "staff@example.com", "--password", "secret"]), /never accept/);
  assert.throws(() => validateArgs({ email: "staff@example.com", role: "OWNER", name: "" }), /role/);
});

test("provisioning password policy matches the Admin UI baseline", () => {
  assert.equal(passwordPolicyProblem("SecurePass123"), null);
  assert.match(passwordPolicyProblem("short1A") ?? "", /12-128/);
  assert.match(passwordPolicyProblem("lowercaseonly123") ?? "", /upper-case/);
  assert.match(passwordPolicyProblem("UPPERCASEONLY123") ?? "", /lower-case/);
  assert.match(passwordPolicyProblem("NoNumbersHereXX") ?? "", /number/);
});
