import assert from "node:assert/strict";
import { test } from "node:test";

import { parseArgs, validateArgs } from "./supabase-user.mjs";

test("provisioning arguments require a role and email but never accept passwords", () => {
  const args = parseArgs(["--email", "staff@example.com", "--role", "billing", "--name", "Billing"]);
  validateArgs(args);
  assert.equal(args.role, "BILLING");
  assert.equal(args.name, "Billing");
  assert.throws(() => parseArgs(["--email", "staff@example.com", "--password", "secret"]), /never accept/);
  assert.throws(() => validateArgs({ email: "staff@example.com", role: "OWNER", name: "" }), /role/);
});
