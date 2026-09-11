/**
 * Captures the main screens for visual review.
 *   node scripts/shots.mjs            (defaults to http://localhost:3000)
 * Screens land in .shots/ and are not part of the app.
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = ".shots";

const VIEWPORTS = {
  desktop: { width: 1280, height: 900 },
  mobile: { width: 390, height: 844 },
};

const PAGES = [
  ["today", "/"],
  ["projects", "/projects"],
  ["billing", "/billing"],
  ["archive", "/archive"],
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();

for (const [size, viewport] of Object.entries(VIEWPORTS)) {
  for (const theme of ["light", "dark"]) {
    for (const locale of ["ja", "en"]) {
      const context = await browser.newContext({
        viewport,
        deviceScaleFactor: 2,
        colorScheme: theme,
      });
      await context.addInitScript(
        ([theme, locale]) => {
          localStorage.setItem("cijd.theme", theme);
          localStorage.setItem("cijd.locale", locale);
        },
        [theme, locale],
      );
      const page = await context.newPage();
      for (const [name, path] of PAGES) {
        await page.goto(BASE + path, { waitUntil: "networkidle" });
        await page.waitForSelector("h1");
        await page.waitForTimeout(400);
        await page.screenshot({
          path: `${OUT}/${size}-${theme}-${locale}-${name}.png`,
          fullPage: false,
        });
      }
      // One project detail per combination.
      await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" });
      const first = page.locator('a[href^="/projects/"]').first();
      await first.waitFor({ timeout: 5000 }).catch(() => {});
      if (await first.count()) {
        await first.click();
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${OUT}/${size}-${theme}-${locale}-project.png` });
      }
      await context.close();
    }
  }
}

await browser.close();
console.log("screens written to", OUT);
