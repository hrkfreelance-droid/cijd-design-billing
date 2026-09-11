/** Captures the modal sheets, which the page-level shots never show. */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = ".shots";
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();

for (const [size, viewport] of Object.entries({
  desktop: { width: 1280, height: 900 },
  mobile: { width: 390, height: 844 },
})) {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2, colorScheme: theme });
    await context.addInitScript(
      ([theme]) => {
        localStorage.setItem("cijd.theme", theme);
        localStorage.setItem("cijd.locale", "ja");
      },
      [theme],
    );
    const page = await context.newPage();
    const shot = (name) => page.screenshot({ path: `${OUT}/sheet-${size}-${theme}-${name}.png` });

    // Create invoice
    await page.goto(`${BASE}/billing`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "請求済みにする" }).first().click();
    await page.waitForTimeout(400);
    await shot("invoice-create");
    await page.keyboard.press("Escape");

    // Invoice detail + payment
    await page.getByRole("tab", { name: /入金待ち/ }).click();
    await page.waitForTimeout(250);
    await page.locator("button").filter({ hasText: "RH-0142" }).first().click();
    await page.waitForTimeout(400);
    await shot("invoice-detail");
    await page.getByRole("button", { name: "入金確認" }).click();
    await page.waitForTimeout(400);
    await shot("payment");
    await page.keyboard.press("Escape");

    // Item editor
    await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" });
    await page.getByRole("link", { name: /Lunch Menu/ }).first().click();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: /A3 Design/ }).first().click();
    await page.waitForTimeout(400);
    await shot("item");

    await context.close();
  }
}

await browser.close();
console.log("sheet screens written");
