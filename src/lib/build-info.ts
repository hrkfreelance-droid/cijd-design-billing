export type BuildInfo = {
  commit: string;
  shortCommit: string;
  branch: string;
  builtAt: string;
  environment: string;
};

/**
 * Deployment identity is injected by scripts/deploy-review.mjs. Never hand-edit
 * a SHA into the UI or docs: /api/version and the HTML meta tag must describe
 * the exact running build.
 */
export function getBuildInfo(): BuildInfo {
  const commit = process.env.CIJD_BUILD_COMMIT?.trim() || "unknown";
  return {
    commit,
    shortCommit: commit === "unknown" ? "unknown" : commit.slice(0, 8),
    branch: process.env.CIJD_BUILD_BRANCH?.trim() || "unknown",
    builtAt: process.env.CIJD_BUILT_AT?.trim() || "unknown",
    environment: process.env.CIJD_BUILD_ENVIRONMENT?.trim() || "unknown",
  };
}
