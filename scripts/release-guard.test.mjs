import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("manual review deploy is hard-locked to the canonical branch and preview worker", async () => {
  const source = await read("scripts/deploy-review.mjs");
  assert.ok(source.includes('const BRANCH = "integrate-production-workspace"'));
  assert.ok(source.includes('const REVIEW_WORKER = "cijd-design-billing-preview"'));
  assert.ok(source.includes('run("npx", ["wrangler", "deploy"'));
  assert.ok(!source.includes("versions upload"));
});

test("Cloudflare Git deploy remains compatible while worker target stays preview-only and authenticated", async () => {
  const pkg = JSON.parse(await read("package.json"));
  const wrangler = await read("wrangler.jsonc");
  assert.equal(pkg.scripts["deploy:review"], "node scripts/deploy-review.mjs");
  assert.equal(
    pkg.scripts["deploy:vinext"],
    "vinext-cloudflare deploy --config dist/server/wrangler.json",
  );
  assert.ok(wrangler.includes('"name": "cijd-design-billing-preview"'));
  assert.ok(!wrangler.includes('"name": "cijd-design-billing"'));
  assert.ok(!wrangler.includes('"CIJD_PILOT_MODE": "1"'));
});

test("live verifier compares canonical commit with remote and blocks false completion", async () => {
  const source = await read("scripts/verify-live.mjs");
  assert.ok(source.includes("refs/remotes/origin/${BRANCH}"));
  assert.ok(source.includes("live.commit !== remoteHead"));
  assert.ok(source.includes("DO NOT CLAIM LIVE COMPLETE"));
  assert.ok(source.includes("/api/version"));
});

test("version endpoint is explicitly uncached", async () => {
  const source = await read("src/app/api/version/route.ts");
  assert.ok(source.includes("no-store"));
  assert.ok(source.includes("getBuildInfo"));
});

test("operation docs define one fixed review URL and separate pass gates", async () => {
  const operation = await read("docs/CANONICAL_OPERATION.md");
  const status = await read("docs/RELEASE_STATUS.md");
  const claude = await read("CLAUDE.md");
  const canonical = "https://cijd-design-billing-preview.hrk-freelance.workers.dev";
  assert.equal(operation.split(canonical).length - 1, 1);
  assert.ok(operation.includes("CODE PASS"));
  assert.ok(operation.includes("DEPLOY PASS"));
  assert.ok(operation.includes("LIVE PASS"));
  assert.ok(status.includes("UNVERIFIED"));
  assert.ok(!/https:\/\/[0-9a-f]{6,}-/i.test(claude));
});
