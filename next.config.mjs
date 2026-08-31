/** @type {import('next').NextConfig} */
const isGitHubPages = process.env.GITHUB_PAGES === "true";
const repositoryName = "cijd-design-billing";
const distDir = process.env.CIJD_NEXT_DIST_DIR?.trim() || ".next";

const nextConfig = {
  reactStrictMode: true,
  // The local app is commonly opened via either hostname. Allowing the
  // loopback alias keeps Next's dev-only HMR endpoint same-origin in both
  // cases, instead of surfacing a misleading dev "Issue" indicator.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  distDir,
  ...(isGitHubPages
    ? {
        output: "export",
        trailingSlash: true,
        basePath: `/${repositoryName}`,
        assetPrefix: `/${repositoryName}/`,
      }
    : {}),
};

export default nextConfig;
