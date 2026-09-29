import { defineConfig, devices } from "@playwright/test";

/**
 * V5 end-to-end, against a running V5 Worker: `wrangler dev` on a local D1
 * (default) or the deployed V5 URL via V5_BASE_URL. Never V3 or V4.
 */
export default defineConfig({
  testDir: "./tests/v5",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.V5_BASE_URL ?? "http://127.0.0.1:8787",
    locale: "en-US",
    viewport: { width: 1360, height: 900 },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1360, height: 900 },
        // PW_EXECUTABLE points at a preinstalled Chromium when the pinned one is absent.
        ...(process.env.PW_EXECUTABLE ? { launchOptions: { executablePath: process.env.PW_EXECUTABLE } } : {}),
      },
    },
  ],
});
