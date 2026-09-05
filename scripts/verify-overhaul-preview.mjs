import { execFileSync } from "node:child_process";

const BRANCH = "review/daishin-uiux-overhaul-20260905";
const URL = process.env.CIJD_CANONICAL_REVIEW_URL || "https://cijd-design-billing-preview.hrk-freelance.workers.dev";

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function fail(message) {
  console.error(`LIVE FAIL: ${message}`);
  console.error("DO NOT CLAIM LIVE COMPLETE");
  process.exit(1);
}

const remoteHead = git("rev-parse", `refs/remotes/origin/${BRANCH}`);

let response;
try {
  response = await fetch(`${URL.replace(/\/$/, "")}/api/version`, {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache" },
  });
} catch (error) {
  fail(`cannot fetch preview /api/version: ${error instanceof Error ? error.message : String(error)}`);
}

if (!response.ok) fail(`/api/version returned HTTP ${response.status}`);
const live = await response.json();
if (!live || typeof live.commit !== "string") fail("/api/version has no commit field");
if (live.branch !== BRANCH) fail(`live branch=${String(live.branch)} expected=${BRANCH}`);
if (live.environment !== "review") fail(`live environment=${String(live.environment)} expected=review`);
if (live.commit !== remoteHead) fail(`remote HEAD=${remoteHead} live HEAD=${live.commit}`);

console.log(`LIVE PASS: ${URL}`);
console.log(`REMOTE HEAD: ${remoteHead}`);
console.log(`LIVE HEAD:   ${live.commit}`);
console.log("LIVE MATCH:  YES");
