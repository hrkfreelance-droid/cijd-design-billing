/** @type {import('next').NextConfig} */
const isGitHubPages = process.env.GITHUB_PAGES === "true";
const repositoryName = "cijd-design-billing";
const distDir = process.env.CIJD_NEXT_DIST_DIR?.trim() || ".next";

const nextConfig = {
  reactStrictMode: true,
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
