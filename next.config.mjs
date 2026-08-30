/** @type {import('next').NextConfig} */
const isGitHubPages = process.env.GITHUB_PAGES === "true";
const repositoryName = "cijd-design-billing";

const nextConfig = {
  reactStrictMode: true,
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
