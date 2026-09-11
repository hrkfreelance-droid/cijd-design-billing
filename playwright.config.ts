import { defineConfig, devices } from "@playwright/test";

const PORT = 3101;

// Next resolves distDir inside the project, so an absolute temp path ends up
// as a `var/…` tree in the repository (and Tailwind then scans it). Use the
// git-ignored `.next-test` directory instead.
const DIST_DIR = ".next-test";

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
  // PW_CHANNEL=chrome runs on the installed Google Chrome instead of a
  // downloaded Playwright browser.
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}) },
    },
  ],
  webServer: {
    // The Supabase vars are blanked explicitly: once real credentials exist in
    // .env.local the app boots in Supabase mode, where the development
    // sign-in this suite relies on is correctly refused. Blanking them keeps
    // the run on the throwaway local store and away from production data.
    command: `rm -rf .data/test.json ${DIST_DIR} && NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= SUPABASE_SERVICE_ROLE_KEY= CIJD_DATA_FILE=.data/test.json CIJD_NEXT_DIST_DIR=${DIST_DIR} CIJD_TEST_MODE=1 CIJD_TEST_NBC_RATE=4047 CIJD_TEST_NBC_RATE_DATE=2026-09-01 TELEGRAM_WEBHOOK_SECRET=test-secret npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    stdout: "pipe",
    stderr: "pipe",
    reuseExistingServer: false,
    // The repository lives on an external volume; the first Turbopack compile
    // there routinely takes longer than the default allowance.
    timeout: 300_000,
  },
});
