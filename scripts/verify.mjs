/**
 * End-to-end check of a running build.
 *   BASE=http://localhost:3000 node scripts/verify.mjs
 *
 * Checks every screen of both workspaces at phone and desktop widths, in both
 * themes and both languages, then walks the real handoff: a designer delivers,
 * billing invoices, accounting confirms payment.
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.env.OUT ?? ".shots/verify";
await mkdir(OUT, { recursive: true });

const PAGES = [
  ["designer-today", "/designer"],
  ["designer-projects", "/designer/projects"],
  ["designer-delivered", "/designer/delivered"],
  ["designer-archive", "/designer/archive"],
  ["office-billing", "/office"],
  ["office-payments", "/office/payments"],
  ["office-archive", "/office/archive"],
];

const results = [];
const fail = (name, detail) => results.push({ ok: false, name, detail });
const pass = (name) => results.push({ ok: true, name });

const browser = await chromium.launch();

async function context(viewport, theme, locale) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, colorScheme: theme });
  await ctx.addInitScript(
    ([theme, locale]) => {
      localStorage.setItem("cijd.theme", theme);
      localStorage.setItem("cijd.locale", locale);
    },
    [theme, locale],
  );
  return ctx;
}

async function signIn(ctx, userId) {
  const response = await ctx.request.post(`${BASE}/api/session`, { data: { userId } });
  if (!response.ok()) throw new Error(`sign-in failed for ${userId}`);
}

/* ------------------------------------------------- layout across the matrix */
for (const [size, viewport] of Object.entries({
  mobile: { width: 390, height: 844 },
  desktop: { width: 1280, height: 900 },
})) {
  for (const theme of ["light", "dark"]) {
    for (const locale of ["ja", "en"]) {
      const ctx = await context(viewport, theme, locale);
      await signIn(ctx, "u_admin");
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));

      for (const [name, path] of PAGES) {
        const label = `${size}/${theme}/${locale}/${name}`;
        await page.goto(BASE + path, { waitUntil: "networkidle" });
        await page.waitForSelector("h1", { timeout: 15000 });
        await page.waitForTimeout(300);

        const metrics = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          heading: document.querySelector("h1")?.textContent ?? "",
          controls: document.querySelectorAll("a,button").length,
        }));
        if (metrics.scrollWidth > metrics.clientWidth + 1) {
          fail(label, `horizontal scroll ${metrics.scrollWidth}>${metrics.clientWidth}`);
        } else if (!metrics.heading || metrics.controls < 8) {
          fail(label, `page looks empty (${metrics.heading}, ${metrics.controls} controls)`);
        } else {
          pass(label);
        }
        await page.screenshot({ path: `${OUT}/${size}-${theme}-${locale}-${name}.png` });
      }
      if (errors.length) fail(`${size}/${theme}/${locale}/console`, errors[0]);
      await ctx.close();
    }
  }
}

/* ---------------------------------- the handoff, across three different people */
{
  const ctx = await context({ width: 390, height: 844 }, "light", "en");
  const page = await ctx.newPage();
  try {
    // Designer: register work and deliver it.
    await signIn(ctx, "u_hiroki");
    const project = await (
      await ctx.request.post(`${BASE}/api/projects`, {
        data: { clientId: "cl_ringer_hut", name: "Verify Poster" },
      })
    ).json();
    await ctx.request.post(`${BASE}/api/billing-items`, {
      data: {
        projectId: project.data.id,
        description: "Poster Design",
        type: "PRINT",
        unitPrice: 60,
      },
    });

    await page.goto(`${BASE}/designer/projects/${project.data.id}`, {
      waitUntil: "networkidle",
    });
    await page.getByRole("button", { name: "Deliver" }).click();
    await page.waitForTimeout(400);
    const box = await page.getByRole("dialog").boundingBox();
    if (!box || box.y < 0 || box.y + box.height > 845) {
      fail("mobile/sheet-fits", `dialog box ${JSON.stringify(box)}`);
    } else {
      pass("mobile/sheet-fits");
    }
    await page.getByRole("dialog").getByRole("button", { name: "Mark as delivered" }).click();
    await page.waitForSelector("text=Marked as delivered", { timeout: 10000 });
    pass("flow/deliver");

    // Billing: only delivered work is visible, and it can be invoiced.
    await signIn(ctx, "u_billing");
    await page.goto(`${BASE}/office`, { waitUntil: "networkidle" });
    await page.waitForSelector("h1");
    await page.getByText("Verify Poster").first().waitFor({ timeout: 10000 });
    const group = page.locator("section").filter({ hasText: "Ringer Hut" });
    await group.getByRole("button", { name: "Mark as Invoiced" }).first().click();
    await page.getByLabel("Invoice number").fill("VERIFY-1");
    await page.getByRole("button", { name: "Create invoice" }).click();
    await page.waitForSelector("text=Invoice VERIFY-1 created", { timeout: 10000 });
    pass("flow/invoice");

    // Accounting: confirm the payment.
    await signIn(ctx, "u_accounting");
    await page.goto(`${BASE}/office/payments`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /VERIFY-1/ }).click();
    await page.screenshot({ path: `${OUT}/flow-invoice-detail.png` });
    await page.getByRole("button", { name: "Confirm payment" }).click();
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await page.waitForSelector("text=Payment confirmed", { timeout: 10000 });
    pass("flow/payment");

    await page.goto(`${BASE}/office/archive`, { waitUntil: "networkidle" });
    await page.waitForSelector("h1");
    await page.getByRole("button", { name: /VERIFY-1/ }).waitFor({ timeout: 10000 });
    pass("flow/archive");

    // Theme and language still work after all that.
    const bar = page.getByRole("banner");
    await bar.getByRole("button", { name: "Switch appearance" }).click();
    await page.waitForTimeout(250);
    const dark = await page.evaluate(() =>
      document.documentElement.classList.contains("dark"),
    );
    if (!dark) fail("flow/theme", "dark class not applied");
    else pass("flow/theme");

    await bar.getByRole("button", { name: "日本語" }).click();
    await page.waitForSelector("h1:has-text('アーカイブ')", { timeout: 5000 });
    pass("flow/language");
  } catch (error) {
    fail("flow", error.message.split("\n")[0]);
    await page.screenshot({ path: `${OUT}/flow-failure.png` });
  }
  await ctx.close();
}

await browser.close();

const failed = results.filter((r) => !r.ok);
for (const r of failed) console.log("ISSUE", r.name, "—", r.detail);
console.log(`${results.length - failed.length}/${results.length} checks passed against ${BASE}`);
process.exit(failed.length ? 1 : 0);
