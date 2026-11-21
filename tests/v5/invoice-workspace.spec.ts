import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { example457, invoiceWorkspaceFixture } from "../fixtures/v5-invoice-workspace";

const output = join(process.cwd(), "screenshots/457");
const phase = process.env.V457_PHASE === "before" ? "before" : "after";
const rule = JSON.parse(readFileSync("docs/design/daishin-ui-rule.json", "utf8"));
const checker = readFileSync("docs/design/check-daishin-ui.js", "utf8");
const reports: unknown[] = [];
const figures: Record<string, unknown> = {};
const paths = [["accounting", "/office-v5/accounting"], ["invoices", "/office-v5/tax-invoices"]] as const;
const closeLabels = { en: "Close", ja: "閉じる", kh: "បិទ" };

// Synthetic HTTP responses only, restricted to a local Worker. No real ledger
// is read or changed, including in the optional baseline screenshot run.
const configuredUrl = new URL(process.env.V5_BASE_URL || "http://127.0.0.1:8787");
test.skip(!["localhost", "127.0.0.1"].includes(configuredUrl.hostname) || !["http:", "https:"].includes(configuredUrl.protocol), "457 is local-only.");
test.use({ headless: true, permissions: ["clipboard-read", "clipboard-write"] });

async function fixture(context: BrowserContext, locale = "en", theme = "light") {
  const snapshot = invoiceWorkspaceFixture();
  await context.addInitScript(([language, mode]) => {
    localStorage.setItem("cijd.locale", language);
    localStorage.setItem("cijd.theme", mode);
  }, [locale, theme]);
  await context.route("**/api/state", (route) => route.fulfill({ json: { ok: true, data: snapshot } }));
  await context.route("**/api/session", (route) => route.fulfill({ json: { ok: true, data: {
    user: { id: "example-457-accountant", name: "Example Accountant", role: "ADMIN" }, users: snapshot.users, auth: "local", access: "active",
  } } }));
  return snapshot;
}

async function photograph(page: Page, name: string) {
  mkdirSync(output, { recursive: true });
  await page.screenshot({ path: join(output, `${phase}-${name}.png`), animations: "disabled" });
}

async function checkDesign(page: Page, name: string) {
  await page.addScriptTag({ content: checker });
  const result = await page.evaluate((rules) => {
    const run = (window as unknown as { checkDaishinUi: (rule: unknown) => { pass: boolean; fails: string[] } }).checkDaishinUi;
    return run(rules);
  }, rule);
  reports.push({ name, ...result });
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "daishin-results.json"), `${JSON.stringify(reports, null, 2)}\n`);
  expect(result.fails, name).toEqual([]);
}

for (const [name, path] of paths) {
  for (const width of [1440, 860, 390]) {
    for (const theme of ["light", "dark"]) {
      for (const locale of ["en", "ja", "kh"] as const) {
        test(`457 ${name} ${width} ${theme} ${locale}: table → Preview → Text → clipboard → close`, async ({ page, context }) => {
          await fixture(context, locale, theme);
          const writes: string[] = [];
          context.on("request", (request) => { if (!["GET", "HEAD"].includes(request.method())) writes.push(request.method() + " " + new URL(request.url()).pathname); });
          await page.setViewportSize({ width, height: 900 });
          await page.goto(path);
          const row = page.getByTestId("v5-issued-row").filter({ hasText: example457.invoiceNumber });
          await expect(row).toBeVisible();
          await page.evaluate(async () => { await document.fonts.ready; });
          const label = `${name}-${width}-${theme}-${locale}`;
          if (name === "accounting") {
            const metrics = await page.locator("[data-testid=v5-accounting] > header dd").evaluateAll((elements) => elements.map((element) => {
              const rect = element.getBoundingClientRect();
              return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, size: getComputedStyle(element).fontSize };
            }));
            figures[label] = metrics;
            mkdirSync(output, { recursive: true });
            writeFileSync(join(output, `${phase}-figures.json`), `${JSON.stringify(figures, null, 2)}\n`);
            const beforePath = join(output, "before-figures.json");
            if (phase === "after" && existsSync(beforePath)) {
              const baseline = JSON.parse(readFileSync(beforePath, "utf8"))[label];
              if (baseline) expect(metrics, "the existing number strip keeps its position and size").toEqual(baseline);
            }
          }
          // Before is intentionally limited to the old list: the old UI has no panel.
          await photograph(page, `${label}-list`);
          if (phase === "before") return;

          await expect(row.locator("td")).toHaveCount(7);
          expect(await row.evaluate((element) => element.getBoundingClientRect().height)).toBeCloseTo(41, 0);
          const numbers = await page.locator(".iv-table td.iv-number").evaluateAll((elements) => elements.map((element) => {
            const range = document.createRange(); range.selectNodeContents(element);
            const fragments = Array.from(range.getClientRects()).filter((rect) => rect.width > 0);
            const cell = element.getBoundingClientRect();
            return { align: getComputedStyle(element).textAlign, tabular: getComputedStyle(element).fontVariantNumeric,
              fits: fragments.every((rect) => rect.left >= cell.left && rect.right <= cell.right),
              lines: new Set(fragments.map((rect) => Math.round(rect.top))).size };
          }));
          expect(numbers.every((entry) => entry.align === "right" && entry.tabular.includes("tabular-nums") && entry.fits && entry.lines === 1)).toBe(true);
          await checkDesign(page, `${label}-list`);
          await row.getByRole("button").click();
          await expect(page).toHaveURL(path);
          const detail = page.getByTestId(width <= 860 ? "v5-invoice-detail-sheet" : "v5-invoice-detail-panel");
          await expect(detail).toBeVisible();
          await expect(detail.getByRole("tab", { name: "Preview", exact: true })).toHaveAttribute("aria-selected", "true");
          await expect(detail.getByTestId("tax-invoice-sheet")).toBeVisible();
          await expect(detail.getByTestId("tax-invoice-customer")).toContainText(example457.customer.companyNameEn);
          await expect(detail.getByTestId("tax-invoice-sheet")).not.toContainText("Updated Name After Issue");
          await expect(detail.getByTestId("v5-preview-open")).toHaveAttribute("href", `/office-v5/tax-invoices/${example457.id}`);
          await expect(detail.getByTestId("v5-panel-print")).toHaveAttribute("href", `/office-v5/tax-invoices/${example457.id}?print=1`);
          await expect.poll(async () => {
            const document = await detail.getByTestId("tax-invoice-sheet").boundingBox();
            const container = await detail.locator(".iv-document").boundingBox();
            return !!document && !!container && document.width <= container.width + 1;
          }).toBe(true);
          if (width > 860) {
            const table = await page.locator(".iv-table-scroll").boundingBox();
            const panel = await detail.boundingBox();
            expect(panel!.x).toBeGreaterThan(table!.x + table!.width);
            expect(Math.abs(panel!.y - table!.y)).toBeLessThan(1);
          }
          await photograph(page, `${label}-preview`);
          await checkDesign(page, `${label}-preview`);
          await detail.getByRole("tab", { name: "Text", exact: true }).click();
          const text = await detail.getByTestId("v5-invoice-text").textContent();
          for (const value of [example457.invoiceNumber, example457.customer.companyNameEn, example457.customer.companyNameKm,
            example457.project.name, ...example457.lines.map((line) => line.description), "2\t$305.00\t$610.00", "500\t$0.24\t$120.00",
            "Sub Total", "730.00", "Discount", "(20.00)", "VAT (10%)", "71.00", "Grand Total in USD", "781.00", "Grand Total in Riel", "3,206,005",
            "Exchange Rate", "4,105", "20-November-2026", "Deposit", "Balance Due", "681.00", "Paid (USD): $150.00", "Outstanding (USD): $631.00",
            "Bank name : ACLEDA Bank Plc.", "ABA Swift Code : ABAAKHPP", "Account No : 29000314877717", "Account No : 000967072",
            "Customer's Signature & Name", "Seller's Signature & Name"]) expect(text).toContain(value);
          await detail.getByTestId("v5-invoice-copy").click();
          await expect(detail.getByTestId("v5-invoice-copy")).toHaveText("Copied");
          expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text);
          await expect(detail.getByTestId("v5-invoice-copy")).toHaveText("Copy", { timeout: 4000 });
          await photograph(page, `${label}-text`);
          await checkDesign(page, `${label}-text`);
          // A4 content survives toggling back and the tab keyboard behavior works.
          await detail.getByRole("tab", { name: "Text", exact: true }).press("Home");
          await expect(detail.getByRole("tab", { name: "Preview", exact: true })).toBeFocused();
          await expect(detail.getByTestId("tax-invoice-sheet")).toBeVisible();
          await detail.getByRole("button", { name: closeLabels[locale], exact: true }).click();
          await expect(detail).toHaveCount(0);
          await expect(row.getByRole("button")).toBeFocused();
          expect(writes).toEqual([]);
        });
      }
    }
  }
}

test("457 invoice kinds, filters, cancelled/paid states, clipboard rejection and selection reset", async ({ page, context }) => {
  test.skip(phase === "before");
  await fixture(context);
  await page.goto("/office-v5/tax-invoices");
  await expect(page.getByTestId("v5-issued-row")).toHaveCount(5);
  await page.getByTestId("v5-invoice-search").fill("CIJDTI2026458");
  const row = page.getByTestId("v5-issued-row");
  await expect(row.locator(".iv-kind")).toHaveText("FINAL");
  await row.getByRole("button").click();
  const detail = page.getByTestId("v5-invoice-detail-panel");
  await detail.getByRole("tab", { name: "Text", exact: true }).click();
  await expect(detail.getByTestId("v5-invoice-text")).toContainText("Contract reconciliation");
  await expect(detail.getByTestId("v5-invoice-text")).toContainText("CIJDTI2026450");
  await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error("Example denied")); });
  await detail.getByTestId("v5-invoice-copy").click();
  await expect(detail.getByRole("status")).toContainText("Select the text");
  await expect(detail.getByTestId("v5-invoice-copy")).toHaveText("Copy");
  await page.getByTestId("v5-invoice-search").fill("");
  await page.getByTestId("v5-invoice-status-filter").selectOption("CANCELLED");
  await expect(detail).toHaveCount(0);
  await expect(row).toHaveCount(1);
  await row.getByRole("button").click();
  await expect(detail.locator(".iv-summary .iv-status")).toContainText("Cancelled");
  await expect(detail.getByRole("button", { name: "Record payment", exact: true })).toHaveCount(0);
  await expect(detail.getByTestId("v5-invoice-payment-add")).toHaveCount(0);
  await page.getByTestId("v5-invoice-status-filter").selectOption("PAID");
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId("v5-row-status")).toHaveText("Collected");
  await page.getByTestId("v5-invoice-year").selectOption("2026");
  await expect(row).toHaveCount(1);
  await page.getByTestId("v5-invoice-search").fill("no matching example");
  await expect(row).toHaveCount(0);
  await expect(page.getByText("No invoices match.")).toBeVisible();
});

test("457 accounting retains numeric order and customer grouping; responsive panel switches at 860", async ({ page, context }) => {
  test.skip(phase === "before");
  await fixture(context);
  await page.goto("/office-v5/accounting");
  const rows = page.getByTestId("v5-issued-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText("EXAMPLE-LONG-INVOICE-2026459");
  await page.getByTestId("v5-issued-sort").selectOption("customer");
  await expect(page.locator(".iv-group")).toHaveCount(1);
  await rows.filter({ hasText: example457.invoiceNumber }).getByRole("button").press("Enter");
  await expect(page.getByTestId("v5-invoice-detail-panel")).toBeVisible();
  await page.setViewportSize({ width: 860, height: 900 });
  const sheet = page.getByTestId("v5-invoice-detail-sheet");
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
});

test("457 payment action reuses validation and history, writes only a synthetic payment", async ({ page, context }) => {
  test.skip(phase === "before");
  const snapshot = await fixture(context);
  let received: unknown;
  await context.route(`**/api/v5/tax-invoices/${example457.id}/payments`, async (route) => {
    received = route.request().postDataJSON();
    const input = received as { amount: number; paidOn: string; note: string };
    snapshot.invoicePayments!.push({ id: "example-457-new-payment", invoiceId: example457.id, kind: "PAYMENT", ...input, createdAt: "2026-11-21T00:00:00Z", createdBy: "Example Accountant" });
    await route.fulfill({ json: { ok: true, data: snapshot.invoicePayments!.at(-1) } });
  });
  await page.goto("/office-v5/accounting");
  await page.getByTestId("v5-issued-row").filter({ hasText: example457.invoiceNumber }).getByRole("button").click();
  const detail = page.getByTestId("v5-invoice-detail-panel");
  await detail.getByRole("button", { name: "Record payment", exact: true }).first().click();
  const amount = detail.getByTestId("v5-invoice-payment-amount");
  await expect(amount).toBeFocused();
  await amount.fill("632");
  await expect(detail.getByTestId("v5-invoice-payment-add")).toBeDisabled();
  await amount.fill("31");
  await detail.getByTestId("v5-invoice-payment-date").fill("2026-11-21");
  await detail.getByTestId("v5-invoice-payment-note").fill("Example payment, local fixture only");
  await detail.getByTestId("v5-invoice-payment-add").click();
  expect(received).toEqual({ amount: 31, paidOn: "2026-11-21", note: "Example payment, local fixture only" });
  await expect(detail.getByTestId("v5-invoice-payment").filter({ hasText: "Example payment, local fixture only" })).toBeVisible();
  await detail.getByRole("tab", { name: "Text", exact: true }).click();
  await expect(detail.getByTestId("v5-invoice-text")).toContainText("Outstanding (USD): $600.00");
  await expect(detail.getByTestId("v5-invoice-text")).toContainText("Paid (USD): $181.00");
});

test("457 print link uses the existing A4 route and preserves document content", async ({ page, context }) => {
  test.skip(phase === "before");
  await fixture(context);
  await context.addInitScript(() => { window.print = () => { (window as unknown as { examplePrinted: number }).examplePrinted = 1; }; });
  await page.goto(`/office-v5/tax-invoices/${example457.id}?print=1`);
  await expect.poll(() => page.evaluate(() => (window as unknown as { examplePrinted?: number }).examplePrinted)).toBe(1);
  await expect(page.getByTestId("tax-invoice-number")).toHaveText(example457.invoiceNumber);
  await expect(page.getByTestId("tax-invoice-sheet")).toContainText("Account No : 000967072");
  await page.emulateMedia({ media: "print" });
  expect(await page.locator(".v5-print-root").evaluate((root) => getComputedStyle(root).visibility)).toBe("visible");
});

test("457 existing Edit/Cancel dialogs are available in the shared panel without changing data", async ({ page, context }) => {
  test.skip(phase === "before");
  await fixture(context);
  const writes: string[] = [];
  context.on("request", (request) => { if (!["GET", "HEAD"].includes(request.method())) writes.push(request.method()); });
  await page.goto("/office-v5/tax-invoices");
  await page.getByTestId("v5-issued-row").filter({ hasText: example457.invoiceNumber }).getByRole("button").click();
  const detail = page.getByTestId("v5-invoice-detail-panel");
  await detail.getByTestId("v5-invoice-cancel").click();
  await expect(page.getByTestId("v5-confirm-cancel")).toBeVisible();
  await expect(page.getByTestId("v5-confirm-cancel-confirm")).toBeDisabled();
  await page.getByTestId("v5-cancel-reason").fill("Example abandoned cancellation");
  await page.getByTestId("v5-confirm-cancel-cancel").click();
  await detail.getByTestId("v5-invoice-edit").click();
  await expect(page.getByTestId("v5-invoice-editor")).toBeVisible();
  await expect(page.getByTestId("v5-edit-reason")).toBeVisible();
  await page.getByTestId("v5-invoice-editor").getByRole("button", { name: "Close", exact: true }).click();
  await expect(detail).toBeVisible();
  expect(writes).toEqual([]);
});
