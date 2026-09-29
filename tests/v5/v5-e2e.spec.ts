import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * CIJD Billing V5, end to end through the real screens:
 * Designer → Invoice Ready → Accounting → Tax Invoice → Print / PDF → reopen.
 *
 * Expected figures (from the V5 calculation layer):
 *   Logo design  Qty 2  × $305.00 (manual)         = $610.00
 *   Flyers A5    Qty 500 × $0.24 cost = $120 → +30% = $156.00 (AUTO)
 *   Subtotal $766.00 · VAT 10% $76.60 · Grand total $842.60 · × 4105 = 3,458,873 KHR
 */

const SHOTS = process.env.V5_SHOTS_DIR ?? "test-results/v5-shots";
const RUN = Date.now().toString(36).slice(-5);
const CLIENT = `E2E Test Customer ${RUN}`;
const PROJECT = `V5 E2E Brochure ${RUN}`;
const MEMO = "Deliver by Friday.\nInvoice to the Khmer company name.";

const problems: string[] = [];

function watch(page: Page) {
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`);
  });
  page.on("requestfailed", (request) => {
    // A navigation away cancels in-flight prefetches; that is not a failure.
    if (request.failure()?.errorText !== "net::ERR_ABORTED") problems.push(`failed ${request.url()} ${request.failure()?.errorText}`);
  });
}

async function prefs(page: Page, locale: "en" | "ja", theme: "light" | "dark") {
  await page.evaluate(
    ([l, th]) => {
      localStorage.setItem("cijd.locale", l);
      localStorage.setItem("cijd.theme", th);
    },
    [locale, theme] as const,
  );
}

async function shot(page: Page, name: string) {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function state(page: Page) {
  const body = await (await page.request.get("/api/state")).json();
  return body.data as {
    projects: { id: string; name: string }[];
    billingItems: { id: string; projectId: string; description: string; quantity: number; unitPrice: number; amount: number; finalMode?: string; billingStatus: string; markupOverride?: number | null }[];
    taxInvoices: { id: string; invoiceNumber: string; project: { name: string }; lines: unknown[]; totalKhr: number }[];
  };
}

test("V5: designer → accounting → tax invoice → print → reopen", async ({ page }) => {
  watch(page);
  await page.goto("/office-v5");
  await prefs(page, "en", "light");
  await page.reload();
  await expect(page.getByTestId("v2-brand")).toBeVisible();
  // V5 shows V3's tabs plus Accounting.
  const nav = page.getByRole("navigation", { name: "Billing" }).first();
  await expect(nav.getByRole("link")).toHaveText(["Billing", "Accounting", "Archive"]);

  /* ---------------------------------------------------------- designer */
  await page.getByTestId("v2-new-project").click();
  const client = page.getByTestId("v2-new-project-client");
  if (!(await page.getByTestId("v2-new-client-name").isVisible())) {
    await client.selectOption({ index: (await client.locator("option").count()) - 1 });
  }
  await page.getByTestId("v2-new-client-name").fill(CLIENT);
  await page.getByTestId("v2-new-project-name").fill(PROJECT);
  await page.getByTestId("v2-create-project").click();

  await page.getByRole("button", { name: `Open ${PROJECT}` }).click();
  const dialog = page.getByRole("dialog", { name: PROJECT });
  await dialog.getByTestId("v2-modal-edit").click();
  await dialog.getByTestId("v2-project-note").fill(MEMO.replace("\n", " "));

  // Line 1: Design, manual unit price 305 × 2.
  await dialog.getByTestId("v2-item-service-0").selectOption("DESIGN");
  await dialog.getByTestId("v2-item-description-0").fill("Logo design");
  await dialog.getByTestId("v2-item-quantity-0").fill("2");
  await dialog.getByTestId("v3-item-final-unit-0").fill("305");
  await expect(dialog.getByTestId("v2-item-final-0")).toHaveValue("610.00");

  // Line 2: Printing, 500 × $0.24 → cost $120 → Recommended $156 (AUTO).
  await dialog.getByTestId("v2-add-item").click();
  await dialog.getByTestId("v2-item-service-1").selectOption("PRINTING");
  await dialog.getByTestId("v2-item-description-1").fill("Flyers A5");
  await dialog.getByTestId("v2-item-quantity-1").fill("500");
  await dialog.getByTestId("v2-item-unit-cost-1").fill("0.24");
  await expect(dialog.getByTestId("v2-item-recommended-1")).toHaveText("$156.00");
  await expect(dialog.getByTestId("v2-item-final-1")).toHaveValue("156.00");
  await expect(dialog.getByTestId("v3-item-final-mode-1")).toHaveAttribute("data-mode", "auto");
  await expect(dialog.getByTestId("v2-modal-total")).toHaveText("$766.00");
  await shot(page, "01-designer-edit-en-light");
  await dialog.getByTestId("v2-modal-save").click();
  await expect(dialog.getByTestId("v2-view-mode")).toBeVisible();

  // Invoice ready.
  await dialog.getByTestId("v2-mark-ready").click();
  await expect(dialog.getByTestId("v2-detail-mark-billed")).toBeVisible();
  await shot(page, "02-designer-ready-en-light");
  await page.keyboard.press("Escape");

  // Stored explicitly and reproduced on reload.
  let data = await state(page);
  const project = data.projects.find((entry) => entry.name === PROJECT)!;
  const lines = data.billingItems.filter((entry) => entry.projectId === project.id);
  const design = lines.find((entry) => entry.description === "Logo design")!;
  const print = lines.find((entry) => entry.description === "Flyers A5")!;
  expect({ q: design.quantity, u: design.unitPrice, a: design.amount, m: design.finalMode }).toEqual({ q: 2, u: 305, a: 610, m: "MANUAL" });
  expect({ q: print.quantity, a: print.amount, m: print.finalMode }).toEqual({ q: 500, a: 156, m: "AUTO" });

  /* -------------------------------------------------------- accounting */
  await page.getByRole("link", { name: "Accounting" }).first().click();
  await expect(page).toHaveURL(/\/office-v5\/accounting$/);
  const row = page.getByTestId("v5-accounting-row").filter({ hasText: PROJECT });
  await expect(row).toBeVisible();
  await expect(row.getByTestId("v5-row-memo")).toContainText("Deliver by Friday.");
  await expect(row.getByTestId("v5-row-total")).toHaveText("$766.00");
  await shot(page, "03-accounting-en-light");

  await row.getByTestId("v5-open-project").click();
  const sheet = page.getByTestId("v5-accounting-modal");
  await expect(sheet.getByTestId("v5-memo")).toContainText("Deliver by Friday.");
  await expect(sheet.getByTestId("v5-details")).toContainText(CLIENT);
  await expect(sheet.getByTestId("v2-view-item")).toHaveCount(2);

  // Payments: 766 − deposit 300 = 466.
  await sheet.getByTestId("v5-payment-kind").selectOption("DEPOSIT");
  await sheet.getByTestId("v5-payment-amount").fill("300");
  await sheet.getByTestId("v5-payment-add").click();
  await expect(sheet.getByTestId("v5-balance-remaining")).toHaveText("$466.00");
  await shot(page, "04-accounting-project-en-light");

  // Prepare Tax Invoice: known data is prefilled.
  await sheet.getByTestId("v5-prepare").click();
  await expect(sheet.getByTestId("v5-name-en")).toHaveValue(CLIENT);
  await expect(sheet.getByTestId("v5-rate-input")).toHaveValue("4105");
  await expect(sheet.getByTestId("v5-rate-source")).toContainText("NBC");
  await expect(sheet.getByTestId("v5-warn-vatin")).toBeVisible();
  await sheet.getByTestId("v5-name-km").fill("ក្រុមហ៊ុន តេស្ត ឯ.ក");
  await sheet.getByTestId("v5-address-en").fill("#12, Street 51, Phnom Penh");
  await sheet.getByTestId("v5-address-km").fill("ផ្ទះលេខ ១២ ផ្លូវ៥១ រាជធានីភ្នំពេញ");
  await sheet.getByTestId("v5-phone").fill("012 345 678");
  await sheet.getByTestId("v5-vatin").fill("K001-123456789");
  const invoiceNumber = await sheet.getByTestId("v5-invoice-number").inputValue();
  expect(invoiceNumber).toMatch(/^CIJDTI\d{7}$/);

  await expect(sheet.getByTestId("v5-subtotal")).toHaveText("$766.00");
  await expect(sheet.getByTestId("v5-vat")).toHaveText("$76.60");
  await expect(sheet.getByTestId("v5-total-usd")).toHaveText("$842.60");
  await expect(sheet.getByTestId("v5-total-khr")).toHaveText("3,458,873 ៛");
  await shot(page, "05-prepare-en-light");

  await sheet.getByTestId("v5-preview").click();
  await expect(sheet.getByTestId("tax-invoice-number")).toHaveText("DRAFT");
  await shot(page, "06-preview-en-light");

  await sheet.getByTestId("v5-issue").click();
  await page.getByTestId("v5-confirm-issue-confirm").click();

  /* ----------------------------------------------------------- invoice */
  await expect(page).toHaveURL(/\/office-v5\/tax-invoices\/[\w-]+$/);
  const invoiceUrl = page.url();
  const doc = page.getByTestId("tax-invoice-sheet");
  await expect(doc.getByTestId("tax-invoice-number")).toHaveText(invoiceNumber);
  const invoiceLines = doc.getByTestId("tax-invoice-line");
  await expect(invoiceLines).toHaveCount(2);
  await expect(invoiceLines.nth(0)).toContainText("Logo design");
  await expect(invoiceLines.nth(0).locator("td").nth(2)).toHaveText("2");
  await expect(invoiceLines.nth(0).locator("td").nth(3)).toContainText("305.00");
  await expect(invoiceLines.nth(0).locator("td").nth(4)).toContainText("610.00");
  await expect(invoiceLines.nth(1).locator("td").nth(2)).toHaveText("500");
  await expect(invoiceLines.nth(1).locator("td").nth(3)).toContainText("0.31");
  await expect(invoiceLines.nth(1).locator("td").nth(4)).toContainText("156.00");
  await expect(doc.getByTestId("tax-invoice-subtotal")).toContainText("766.00");
  await expect(doc.getByTestId("tax-invoice-vat")).toContainText("76.60");
  await expect(doc.getByTestId("tax-invoice-total-usd")).toContainText("842.60");
  await expect(doc.getByTestId("tax-invoice-total-khr")).toHaveText("3,458,873");
  await expect(doc.getByTestId("tax-invoice-customer")).toContainText("K001-123456789");
  await expect(doc).toContainText("វិក្កយបត្រអាករ");
  await expect(doc).toContainText("TAX INVOICE");
  await expect(doc).toContainText("K002-901900787");
  await expect(doc).toContainText("Account No : 29000314877717");
  await expect(doc).toContainText("Seller's Signature & Name");

  // Khmer is drawn with a real Khmer face, not boxes.
  await page.evaluate(() => document.fonts.ready);
  const khmer = await page.evaluate(() => ({
    noto: document.fonts.check('12px "Noto Sans Khmer"', "វិក្កយបត្រ"),
    moul: document.fonts.check('12px "Moul"', "វិក្កយបត្រ"),
  }));
  expect(khmer).toEqual({ noto: true, moul: true });
  await shot(page, "07-invoice-en-light");

  // Print / Save PDF: only the invoice, one A4 page.
  await page.emulateMedia({ media: "print" });
  await expect(page.getByTestId("v5-print")).toBeHidden();
  await page.screenshot({ path: `${SHOTS}/08-print-media.png`, fullPage: true });
  const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
  writeFileSync(`${SHOTS}/tax-invoice.pdf`, pdf);
  const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  expect(pages).toBe(1);
  await page.emulateMedia({ media: "screen" });

  /* ------------------------------------------------------- persistence */
  // Later edits to the project do not reach the issued invoice.
  const renamed = await page.request.patch(`/api/projects/${project.id}`, { data: { name: `${PROJECT} (renamed)` } });
  expect(renamed.ok()).toBeTruthy();
  await page.goto(invoiceUrl);
  await expect(page.getByTestId("v5-invoice-heading")).toHaveText(invoiceNumber);
  await expect(page.getByTestId("v5-invoice-status")).toHaveText("Issued");
  await expect(page.getByTestId("tax-invoice-total-khr")).toHaveText("3,458,873");
  data = await state(page);
  const issued = data.taxInvoices.find((entry) => entry.invoiceNumber === invoiceNumber)!;
  expect(issued.project.name).toBe(PROJECT);
  expect(issued.lines).toHaveLength(2);
  // The project itself is intact and billed.
  expect(data.billingItems.filter((entry) => entry.projectId === project.id).map((entry) => [entry.amount, entry.billingStatus]).sort()).toEqual([
    [156, "INVOICED"],
    [610, "INVOICED"],
  ]);

  // Back to Accounting: gone from the queue, listed as issued; Archive has it too.
  await page.getByTestId("v5-invoice-back").click();
  await expect(page.getByTestId("v5-accounting-row").filter({ hasText: PROJECT })).toHaveCount(0);
  await expect(page.getByTestId("v5-issued-row").filter({ hasText: invoiceNumber })).toBeVisible();
  await page.getByRole("link", { name: "Archive" }).first().click();
  await expect(page.getByText(`${PROJECT} (renamed)`).first()).toBeVisible();
  await expect(page.getByTestId("v5-issued-row").filter({ hasText: invoiceNumber })).toBeVisible();
  await page.getByTestId("v5-issued-row").filter({ hasText: invoiceNumber }).click();
  await expect(page.getByTestId("tax-invoice-number")).toHaveText(invoiceNumber);

  /* ------------------------------------------- languages and themes */
  for (const [locale, theme] of [["ja", "light"], ["ja", "dark"], ["en", "dark"], ["kh", "light"]] as const) {
    await prefs(page, locale as "en", theme);
    for (const [path, name] of [["/office-v5", "billing"], ["/office-v5/accounting", "accounting"], ["/office-v5/archive", "archive"], [invoiceUrl, "invoice"]] as const) {
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("lang", locale === "kh" ? "km" : locale);
      if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
      await page.waitForLoadState("networkidle");
      await shot(page, `09-${name}-${locale}-${theme}`);
    }
  }
  await prefs(page, "ja", "light");
  await page.goto("/office-v5/accounting");
  await expect(page.getByRole("heading", { name: "経理" })).toBeVisible();
  await expect(page.getByRole("link", { name: "経理" }).first()).toBeVisible();

  // Phone width: no horizontal scroll; the A4 sheet scales down to fit.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [path, name] of [["/office-v5/accounting", "accounting"], [invoiceUrl, "invoice"]] as const) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${name} scrolls sideways`).toBeLessThanOrEqual(0);
    await shot(page, `10-${name}-phone`);
  }

  expect(problems, problems.join("\n")).toEqual([]);
});
