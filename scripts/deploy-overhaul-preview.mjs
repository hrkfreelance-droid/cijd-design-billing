import { execFileSync, spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const BRANCH = "review/daishin-uiux-overhaul-20260905";
const REVIEW_WORKER = "cijd-design-billing-preview";
const GENERATED = "dist/server/wrangler.json";
const REVIEW_CONFIG = "dist/server/wrangler.overhaul-preview.json";

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function fail(message) {
  console.error(`DEPLOY BLOCKED: ${message}`);
  process.exit(1);
}

function run(command, args, env) {
  const result = spawnSync(command, args, { stdio: "inherit", env });
  if (result.status !== 0) fail(`${command} ${args.join(" ")} failed`);
}

console.log("[CIJD] fetch remote truth");
run("git", ["fetch", "--all", "--prune"], process.env);

const branch = git("rev-parse", "--abbrev-ref", "HEAD");
if (branch !== BRANCH) fail(`overhaul preview deploy is allowed only from ${BRANCH}; current=${branch}`);

const localHead = git("rev-parse", "HEAD");
const remoteHead = git("rev-parse", `refs/remotes/origin/${BRANCH}`);
if (localHead !== remoteHead) fail(`local HEAD ${localHead} does not match origin/${BRANCH} ${remoteHead}`);

const rollbackHead = git("rev-parse", "refs/remotes/origin/integrate-production-workspace");
console.log(`[CIJD] rollback source remains integrate-production-workspace ${rollbackHead}`);

const builtAt = new Date().toISOString();
const buildEnv = {
  ...process.env,
  CIJD_BUILD_COMMIT: localHead,
  CIJD_BUILD_BRANCH: BRANCH,
  CIJD_BUILT_AT: builtAt,
  CIJD_BUILD_ENVIRONMENT: "review",
};

console.log(`[CIJD] build ${localHead.slice(0, 8)} for existing Review Worker`);
run("npm", ["run", "build:vinext"], buildEnv);

let config;
try {
  config = JSON.parse(await readFile(GENERATED, "utf8"));
} catch (error) {
  fail(`could not read generated ${GENERATED}: ${error instanceof Error ? error.message : String(error)}`);
}

config.name = REVIEW_WORKER;
config.vars = {
  ...(config.vars ?? {}),
  CIJD_BUILD_COMMIT: localHead,
  CIJD_BUILD_BRANCH: BRANCH,
  CIJD_BUILT_AT: builtAt,
  CIJD_BUILD_ENVIRONMENT: "review",
  CIJD_ROLLBACK_COMMIT: rollbackHead,
};

if (config.name !== REVIEW_WORKER || !config.name.endsWith("-preview")) fail(`refusing to deploy worker ${String(config.name)}`);

await writeFile(REVIEW_CONFIG, `${JSON.stringify(config, null, 2)}\n`, "utf8");
console.log(`[CIJD] deploy only ${REVIEW_WORKER}`);
run("npx", ["wrangler", "deploy", "--config", REVIEW_CONFIG], buildEnv);
console.log(`[CIJD] DEPLOY COMMAND PASS ${REVIEW_WORKER} ${localHead}`);
console.log(`[CIJD] ROLLBACK SOURCE ${rollbackHead}`);
