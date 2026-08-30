import { defineConfig, devices } from "@playwright/test";

const PORT = 3101;

/** Runs against a throwaway data file so the demo store is never touched. */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "en-US",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `rm -f .data/test.json && CIJD_DATA_FILE=.data/test.json CIJD_NEXT_DIST_DIR=.next-local TELEGRAM_WEBHOOK_SECRET=test-secret npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    stdout: "pipe",
    stderr: "pipe",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
