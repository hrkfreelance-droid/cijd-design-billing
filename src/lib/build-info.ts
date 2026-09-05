import { GENERATED_BUILD_INFO } from "./build-info.generated";

export type BuildInfo = {
  commit: string;
  shortCommit: string;
  branch: string;
  builtAt: string;
  environment: string;
};

/**
 * Review build identity is captured as source before vinext compiles the app.
 * Cloudflare Workers Builds exposes WORKERS_CI_COMMIT_SHA / WORKERS_CI_BRANCH
 * only while building, so runtime verification reads these immutable literals.
 */
export function getBuildInfo(): BuildInfo {
  const commit = String(GENERATED_BUILD_INFO.commit || "unknown");
  return {
    commit,
    shortCommit: commit === "unknown" ? "unknown" : commit.slice(0, 8),
    branch: GENERATED_BUILD_INFO.branch || "unknown",
    builtAt: GENERATED_BUILD_INFO.builtAt || "unknown",
    environment: GENERATED_BUILD_INFO.environment || "unknown",
  };
}
