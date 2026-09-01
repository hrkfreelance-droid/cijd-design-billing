import { defineConfig, devices } from "@playwright/test";

const PORT = 3101;

/**
 * Runs against a throwaway data file so the demo store is never touched, and
 * builds into its own dist dir so the suite can run while `npm run dev` is up —
 * sharing `.next-local` makes the second dev server refuse to start.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "en-US",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // The Supabase vars are blanked explicitly: once real credentials exist in
    // .env.local the app boots in Supabase mode, where the development
    // sign-in this suite relies on is correctly refused. Blanking them keeps
    // the run on the throwaway local store and away from production data.
    command: `rm -f .data/test.json && NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= SUPABASE_SERVICE_ROLE_KEY= CIJD_DATA_FILE=.data/test.json CIJD_NEXT_DIST_DIR=.next-test CIJD_TEST_MODE=1 CIJD_TEST_NBC_RATE=4047 CIJD_TEST_NBC_RATE_DATE=2026-09-01 TELEGRAM_WEBHOOK_SECRET=test-secret npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    stdout: "pipe",
    stderr: "pipe",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
