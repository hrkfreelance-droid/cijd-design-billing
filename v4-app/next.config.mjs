/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir: process.env.CIJD_NEXT_DIST_DIR?.trim() || ".next",
  outputFileTracingRoot: process.cwd(),
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
