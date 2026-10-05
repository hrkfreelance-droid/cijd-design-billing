import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

import { invoiceTotals } from "../../src/lib/billing-v5/calculation";

/**
 * CIJD Billing V5 — invoice management, end to end through the real screens.
 *
 *   Designer: TEST project (Design 2 × $305 manual, Printing 500 × $0.24 AUTO → $156), memo, ready
 *   Accounting: Customer Master, Product Master, two billings of one customer on one invoice
 *     (the $1,000 website billed $300 of), a product line, a free line saved to the list,
 *     discount (before VAT), deposit, NBC rate for the
 *     invoice date → issue → PDF (one A4 page; logo/company/VATIN/bank as the
 *     verified source, no QR — the source has none)
 *   Payments: partial → edit (date kept → rate kept) → final → Collected
 *   Partial billing: $1,000 → $300 / $300 / $400 → fully invoiced; over-allocation refused
 *   Masters edited afterwards do not change the issued invoice
 *
 * Everything created is named TEST; invoices for TEST customers are numbered
 * TEST-CIJDTI…, so a run on the live V5 never uses a real invoice number.
 * On the deployed V5 (V5_BASE_URL) it cleans up after itself. Imported V3
 * records are only read, and are checked unchanged at the end.
 */

const SHOTS = process.env.V5_SHOTS_DIR ?? "test-results/v5-shots";
const RUN = Date.now().toString(36).slice(-5);
const DEPLOYED = !!process.env.V5_BASE_URL;
const CLIENT = `TEST E2E Customer ${RUN}`;
const OTHER = `TEST E2E Other ${RUN}`;
const PROJECT = `TEST V5 E2E Brochure ${RUN}`;
const WEBSITE = `TEST V5 E2E Website ${RUN}`;
const OTHER_PROJECT = `TEST V5 E2E Other ${RUN}`;
const PRODUCT = `TEST Hosting ${RUN}`;
const FREE = `TEST Rush fee ${RUN}`;
const MEMO = "Deliver by Friday. Invoice to the Khmer company name.";

const problems: string[] = [];
/** Requests the test sends on purpose to prove they are refused. */
const expectedFailures = new Set<string>();

function watch(page: Page) {
  page.on("console", (message) => {
    if (message.type() === "error" && !(expectedFailures.size && /status of 409/.test(message.text()))) problems.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 400 && !expectedFailures.has(`${response.request().method()} ${new URL(response.url()).pathname}`)) {
      problems.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });
  page.on("requestfailed", (request) => {
    if (request.failure()?.errorText !== "net::ERR_ABORTED") problems.push(`failed ${request.url()} ${request.failure()?.errorText}`);
  });
}

async function prefs(page: Page, locale: "en" | "ja" | "kh", theme: "light" | "dark") {
  await page.evaluate(([l, th]) => {
    localStorage.setItem("cijd.locale", l);
    localStorage.setItem("cijd.theme", th);
  }, [locale, theme] as const);
}

async function shot(page: Page, name: string) {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

type State = {
  clients: { id: string; name: string; active: boolean }[];
  projects: { id: string; name: string; clientId: string; note?: string }[];
  billingItems: { id: string; projectId: string; description: string; quantity: number; unitPrice: number; amount: number; finalMode?: string; billingStatus: string }[];
  taxInvoices: { id: string; invoiceNumber: string; status: string; clientId: string; invoiceDate: string; totalUsd: number; exchangeRate: number; customer: Record<string, string>; lines: Record<string, unknown>[]; revision?: number; discount?: unknown; vatApplicable: boolean; subtotalUsd?: number; discountUsd?: number; taxableUsd?: number; vatUsd?: number; depositUsd?: number; discountPolicy?: string | null; exchangeRateSource?: string; exchangeRateBasis?: string; exchangeRateForDate?: string }[];
  products: { id: string; description: string; active: boolean; productCode: string }[];
  customers: { id: string; customerCode: string; companyNameEn: string; active: boolean }[];
  invoicePayments: { id: string; invoiceId: string; kind: string; amount: number; voidedAt?: string | null }[];
  billingAllocations: { billingItemId: string; invoiceId: string; amount: number; voidedAt?: string | null }[];
};
async function state(page: Page): Promise<State> {
  return (await (await page.request.get("/api/state")).json()).data as State;
}

async function readyProject(page: Page, clientId: string, name: string, items: Record<string, unknown>[]) {
  const project = (await (await page.request.post("/api/projects", { data: { clientId, name } })).json()).data as { id: string };
  for (const item of items) {
    expect((await page.request.post("/api/billing-items", { data: { projectId: project.id, finalMode: "MANUAL", ...item } })).ok()).toBeTruthy();
  }
  expect((await page.request.patch(`/api/projects/${project.id}/readiness`, { data: { readiness: "READY" } })).ok()).toBeTruthy();
  expect((await page.request.patch(`/api/projects/${project.id}/readiness`, { data: { readiness: "ACCOUNTING" } })).ok()).toBeTruthy();
  return project.id;
}

test("V5 invoice management: designer → accounting → invoice → payments → partial billing", async ({ page }) => {
  test.setTimeout(300_000);
  watch(page);
  await page.goto("/office-v5");
  await prefs(page, "en", "light");
  await page.reload();
  await expect(page.getByRole("navigation", { name: "Billing" }).first().getByRole("link")).toHaveText(["Billing", "Accounting", "Archive"]);

  /* ------------------------------------------- imported V3 data (read only) */
  const fingerprint = async () => {
    const st = await state(page);
    const tests = new Set(st.projects.filter((p) => p.name.startsWith("TEST")).map((p) => p.id));
    return JSON.stringify({
      projects: st.projects.filter((p) => !tests.has(p.id)).map((p) => [p.id, p.name, p.note ?? ""]).sort(),
      lines: st.billingItems.filter((i) => !tests.has(i.projectId)).map((i) => [i.id, i.quantity, i.unitPrice, i.amount, i.billingStatus, i.finalMode ?? null]).sort(),
      invoices: st.taxInvoices.filter((i) => !i.invoiceNumber.startsWith("TEST-")).map((i) => [i.id, i.invoiceNumber, i.status, i.totalUsd]).sort(),
    });
  };
  const importedBefore = await fingerprint();
  if (process.env.V5_EXPECT_IMPORTED === "1") expect((await state(page)).projects.filter((p) => !p.name.startsWith("TEST")).length).toBeGreaterThan(0);

  /* ---------------------------------------------------------- designer */
  await page.getByTestId("v2-new-project").click();
  const clientSelect = page.getByTestId("v2-new-project-client");
  if (!(await page.getByTestId("v2-new-client-name").isVisible())) {
    await clientSelect.selectOption({ index: (await clientSelect.locator("option").count()) - 1 });
  }
  await page.getByTestId("v2-new-client-name").fill(CLIENT);
  await page.getByTestId("v2-new-project-name").fill(PROJECT);
  await page.getByTestId("v2-create-project").click();
  await page.getByRole("button", { name: `Open ${PROJECT}` }).click();
  const dialog = page.getByRole("dialog", { name: PROJECT });
  await dialog.getByTestId("v2-modal-edit").click();
  await dialog.getByTestId("v2-project-note").fill(MEMO);
  await dialog.getByTestId("v2-item-service-0").selectOption("DESIGN");
  await dialog.getByTestId("v2-item-description-0").fill("Logo design");
  await dialog.getByTestId("v2-item-quantity-0").fill("2");
  await dialog.getByTestId("v3-item-final-unit-0").fill("305");
  await dialog.getByTestId("v2-add-item").click();
  await dialog.getByTestId("v2-item-service-1").selectOption("PRINTING");
  await dialog.getByTestId("v2-item-description-1").fill("Flyers A5");
  await dialog.getByTestId("v2-item-quantity-1").fill("500");
  await dialog.getByTestId("v2-item-unit-cost-1").fill("0.24");
  await expect(dialog.getByTestId("v2-item-final-1")).toHaveValue("156.00");
  await expect(dialog.getByTestId("v2-modal-total")).toHaveText("$766.00");
  await dialog.getByTestId("v2-modal-save").click();
  await expect(dialog.getByTestId("v2-view-mode")).toBeVisible();
  await dialog.getByTestId("v2-mark-ready").click();
  await expect(dialog.getByTestId("v2-detail-mark-billed")).toBeVisible();
  await dialog.getByTestId("v2-detail-mark-billed").click();
  await page.getByTestId("v2-confirm-bill-confirm").click();
  await expect(dialog).toHaveCount(0);

  let st = await state(page);
  const client = st.clients.find((c) => c.name === CLIENT)!;
  // A second billing of the same customer: a $1,000 website, billed in parts.
  const websiteProject = await readyProject(page, client.id, WEBSITE, [{ description: "Website", type: "DESIGN", serviceType: "DESIGN", quantity: 1, amount: 1000 }]);
  // Another customer's work, to show one invoice bills one customer.
  const other = (await (await page.request.post("/api/clients", { data: { name: OTHER } })).json()).data as { id: string };
  await readyProject(page, other.id, OTHER_PROJECT, [{ description: "Other", type: "DESIGN", serviceType: "DESIGN", quantity: 1, amount: 50 }]);
  st = await state(page);
  const website = st.billingItems.find((i) => i.projectId === websiteProject)!;

  /* ------------------------------------------------------ customer master */
  await page.goto("/office-v5/accounting?view=customers");
  await page.getByTestId("v5-customer-search").fill(CLIENT);
  await page.getByTestId("v5-customer-row").filter({ hasText: CLIENT }).click();
  const customerSheet = page.getByTestId("v5-customer-sheet");
  await customerSheet.getByTestId("v5-customer-companyNameEn").fill(`${CLIENT} Co., Ltd.`);
  await customerSheet.getByTestId("v5-customer-companyNameKm").fill("ក្រុមហ៊ុន តេស្ត ឯ.ក");
  await customerSheet.getByTestId("v5-customer-addressEn").fill("#12, Street 51, Phnom Penh");
  await customerSheet.getByTestId("v5-customer-addressKm").fill("ផ្ទះលេខ ១២ ផ្លូវ៥១ រាជធានីភ្នំពេញ");
  await customerSheet.getByTestId("v5-customer-telephone").fill("012 345 678");
  await customerSheet.getByTestId("v5-customer-vatin").fill("K001-123456789");
  await customerSheet.getByTestId("v5-customer-email").fill("test@example.com");
  await customerSheet.getByTestId("v5-customer-save").click();
  await expect(customerSheet).toHaveCount(0);
  await shot(page, "01-customers-en-light");

  /* ------------------------------------------------------- product master */
  await page.getByRole("tab", { name: /Products/ }).click();
  await page.getByTestId("v5-product-new").click();
  const productSheet = page.getByTestId("v5-product-sheet");
  await productSheet.getByTestId("v5-product-description").fill(PRODUCT);
  await productSheet.getByTestId("v5-product-price").fill("120");
  await productSheet.getByTestId("v5-product-unit").fill("year");
  await productSheet.getByTestId("v5-product-save").click();
  await expect(page.getByTestId("v5-product-row").filter({ hasText: PRODUCT })).toBeVisible();
  await shot(page, "02-products-en-light");

  /* ------------------------------------------------- select and invoice */
  await page.getByRole("tab", { name: /To invoice/ }).click();
  const row = (name: string) => page.getByTestId("v5-accounting-row").filter({ hasText: name });
  await expect(row(PROJECT).getByTestId("v5-row-memo")).toContainText("Deliver by Friday");
  await row(OTHER_PROJECT).getByTestId("v5-select-project").click();
  await row(PROJECT).getByTestId("v5-select-project").click(); // different customer: the selection switches
  await expect(page.getByText("One invoice bills one customer")).toBeVisible();
  await row(WEBSITE).getByTestId("v5-select-project").click();
  await expect(page.getByTestId("v5-selected-total")).toHaveText("$1,766.00");
  await shot(page, "03-to-invoice-selected-en-light");
  await page.getByTestId("v5-create-invoice").click();

  const editor = page.getByTestId("v5-invoice-editor");
  await expect(editor.getByTestId("v5-name-en")).toHaveValue(`${CLIENT} Co., Ltd.`); // from the Customer Master
  await expect(editor.getByTestId("v5-vatin")).toHaveValue("K001-123456789");
  await expect(editor.getByTestId("v5-editor-row")).toHaveCount(3);
  await expect(editor.getByTestId("v5-invoice-number")).toHaveText("Assigned when issued");
  // Bill $300 of the website now; more than is left is refused on screen.
  const websiteIndex = await editor.locator('[data-testid^="v5-row-description-"]').evaluateAll((inputs) => inputs.findIndex((input) => (input as HTMLInputElement).value === "Website"));
  await editor.getByTestId(`v5-row-amount-${websiteIndex}`).fill("1000.01");
  await expect(editor.getByTestId(`v5-row-error-${websiteIndex}`)).toContainText("$1,000.00");
  await expect(editor.getByTestId("v5-issue")).toBeDisabled();
  await editor.getByTestId(`v5-row-amount-${websiteIndex}`).fill("300");
  // A product line and a free line.
  await editor.getByTestId("v5-add-line").click();
  await editor.getByTestId("v5-row-description-3").fill(PRODUCT);
  await expect(editor.getByTestId("v5-row-price-3")).toHaveValue("120.00");
  await editor.getByTestId("v5-add-line").click();
  await editor.getByTestId("v5-row-description-4").fill(FREE);
  await editor.getByTestId("v5-row-price-4").fill("50");
  // Discount (reduces the taxable amount, before VAT), deposit, rate for the invoice date.
  await editor.getByTestId("v5-discount-type").selectOption("FIXED");
  await editor.getByTestId("v5-discount-value").fill("20");
  await editor.getByTestId("v5-deposit").fill("100");
  const rateInput = editor.getByTestId("v5-rate-input");
  await expect(editor.getByTestId("v5-rate-source")).not.toHaveText("");
  if (await rateInput.inputValue()) {
    // NBC has the rate for this date: it is used as is, not typed over.
    await expect(rateInput).toBeDisabled();
    await expect(editor.getByTestId("v5-rate-source")).toContainText("NBC");
  } else {
    // No NBC rate can be established for the date: shown, typed by hand, saved as MANUAL.
    await expect(editor.getByTestId("v5-rate-none")).toBeVisible();
    await expect(rateInput).toBeEnabled();
    await rateInput.fill("4105");
  }
  const rate = Number(await rateInput.inputValue());
  const expected = invoiceTotals({ lines: [{ amount: 610 }, { amount: 156 }, { amount: 300 }, { amount: 120 }, { amount: 50 }], discount: { type: "FIXED", value: 20 }, vatApplicable: true, exchangeRate: rate, deposit: 100 });
  expect([expected.subtotalUsd, expected.taxableUsd, expected.vatUsd, expected.totalUsd, expected.balanceDueUsd]).toEqual([1236, 1216, 121.6, 1337.6, 1237.6]);
  await expect(editor.getByTestId("v5-subtotal")).toHaveText("$1,236.00");
  await expect(editor.getByTestId("v5-discount")).toHaveText("−$20.00");
  await expect(editor.getByTestId("v5-vat")).toHaveText("$121.60");
  await expect(editor.getByTestId("v5-total-usd")).toHaveText("$1,337.60");
  await expect(editor.getByTestId("v5-total-khr")).toHaveText(`${expected.totalKhr.toLocaleString("en-US")} ៛`);
  await expect(editor.getByTestId("v5-balance-due")).toHaveText("$1,237.60");
  await shot(page, "04-editor-en-light");
  await editor.getByTestId("v5-preview").click();
  await expect(editor.getByTestId("tax-invoice-number")).toHaveText("DRAFT");
  await expect(editor.getByTestId("tax-invoice-discount")).toContainText("(20.00)");
  await expect(editor.getByTestId("tax-invoice-balance-due")).toContainText("1,237.60");
  // Several projects on one invoice: each billed line shows its project above the description.
  await expect(editor.getByTestId("tax-invoice-line-project")).toHaveText([PROJECT, PROJECT, WEBSITE]);
  await shot(page, "05-preview-en-light");
  await editor.getByTestId("v5-issue").click();
  // The free line is not in the Product List: asked, never added silently.
  await expect(page.getByTestId("v5-confirm-products")).toContainText(FREE);
  await page.getByTestId("v5-confirm-products-confirm").click();
  await page.getByTestId("v5-confirm-issue-confirm").click();

  /* -------------------------------------------------------- the invoice */
  await expect(page).toHaveURL(/\/office-v5\/tax-invoices\/[\w-]+$/);
  const invoiceUrl = page.url();
  const number = (await page.getByTestId("v5-invoice-heading").innerText()).trim();
  expect(number).toMatch(/^TEST-CIJDTI\d{7}$/);
  const doc = page.getByTestId("tax-invoice-sheet");
  await expect(doc.getByTestId("tax-invoice-number")).toHaveText(number);
  await expect(doc.getByTestId("tax-invoice-line")).toHaveCount(5);
  await expect(doc.getByTestId("tax-invoice-line-project")).toHaveText([PROJECT, PROJECT, WEBSITE]); // product and free lines: none
  await expect(doc.getByTestId("tax-invoice-line").nth(0)).toContainText("Logo design");
  await expect(doc.getByTestId("tax-invoice-subtotal")).toContainText("1,236.00");
  await expect(doc.getByTestId("tax-invoice-discount")).toContainText("(20.00)");
  await expect(doc.getByTestId("tax-invoice-vat")).toContainText("121.60");
  await expect(doc.getByTestId("tax-invoice-total-usd")).toContainText("1,337.60");
  await expect(doc.getByTestId("tax-invoice-total-khr")).toHaveText(expected.totalKhr.toLocaleString("en-US"));
  await expect(doc.getByTestId("tax-invoice-deposit")).toContainText("(100.00)");
  await expect(doc.getByTestId("tax-invoice-balance-due")).toContainText("1,237.60");
  // E. Visual assets as in the verified current source (V4 InvoiceDocument):
  // logo, company, VATIN, both bank accounts, signatures — and no QR, because
  // no branch, asset or template of this repository has one.
  await expect(doc).toContainText("វិក្កយបត្រអាករ");
  await expect(doc).toContainText("ស៊ីអាយជេឌី ឯ.ក");
  await expect(doc).toContainText("CIJD CO., LTD.");
  await expect(doc).toContainText("K002-901900787");
  await expect(doc).toContainText("Bank name : ACLEDA Bank Plc.");
  await expect(doc).toContainText("Account No : 29000314877717");
  await expect(doc).toContainText("ABA Swift Code : ABAAKHPP");
  await expect(doc).toContainText("Account No : 000967072");
  await expect(doc).toContainText("Customer's Signature & Name");
  await expect(doc).toContainText("Seller's Signature & Name");
  const images = doc.locator("img");
  await expect(images).toHaveCount(1);
  await expect(images.first()).toHaveAttribute("src", /\/assets\/cijd-logo\.jpg/);
  expect(await images.first().evaluate((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0)).toBe(true);
  await expect(doc.locator("canvas, svg, [data-qr], [class*=qr i], [alt*=qr i]")).toHaveCount(0);
  const saved0 = (await state(page)).taxInvoices.find((i) => i.invoiceNumber === number)!;
  expect(saved0.exchangeRateForDate).toBe(saved0.invoiceDate);
  expect(saved0.exchangeRateSource === "MANUAL" ? saved0.exchangeRateBasis === "MANUAL" : ["EXACT", "IN_EFFECT"].includes(saved0.exchangeRateBasis!)).toBe(true);
  // Stored exactly as calculated: discount before VAT, the deposit after the Grand Total.
  expect(saved0).toMatchObject({ subtotalUsd: 1236, discountUsd: 20, taxableUsd: 1216, vatUsd: 121.6, totalUsd: 1337.6, depositUsd: 100, discountPolicy: "DISCOUNT_BEFORE_VAT" });
  // NBC rate rule, on the server: no look-back (a date days after the newest
  // rate has none unless NBC gave that exact date), and no manual override
  // when NBC has the rate. Refused requests write nothing.
  const ahead = new Date(Date.parse(`${saved0.invoiceDate}T00:00:00Z`) + 5 * 86_400_000).toISOString().slice(0, 10);
  const lookAhead = (await (await page.request.get(`/api/v5/exchange-rate?date=${ahead}`)).json()).data as { rate: { effectiveDate: string } | null };
  expect(lookAhead.rate === null || lookAhead.rate.effectiveDate === ahead).toBe(true);
  const old = (await (await page.request.get("/api/v5/exchange-rate?date=2020-01-06")).json()).data as { rate: unknown };
  expect(old.rate).toBeNull();
  if (saved0.exchangeRateSource === "NBC") {
    const override = await page.request.post("/api/v5/tax-invoices", {
      data: { customerId: client.id, invoiceDate: saved0.invoiceDate, customer: { companyNameEn: `${CLIENT} Co., Ltd.` }, exchangeRate: { rate: 4000, source: "MANUAL" }, items: [{ description: "TEST manual refused", quantity: 1, unitPrice: 10 }] },
    });
    expect([override.status(), (await override.json()).code]).toEqual([409, "RATE_AVAILABLE"]);
  }
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('12px "Noto Sans Khmer"', "វិក្កយបត្រ"))).toBe(true);
  await expect(page.getByTestId("v5-outstanding")).toContainText("$1,237.60"); // the deposit counts as paid
  await shot(page, "06-invoice-en-light");

  // Print / Save PDF: only the invoice, one A4 page even with discount and deposit rows.
  await page.emulateMedia({ media: "print" });
  await expect(page.getByTestId("v5-print")).toBeHidden();
  await expect(page.getByTestId("v5-invoice-payments")).toBeHidden();
  await page.screenshot({ path: `${SHOTS}/07-print-media.png`, fullPage: true });
  // The two-line project cells never push the signatures off the one A4 page.
  const fit = await page.evaluate(() => {
    const sheet = document.querySelector(".invoice-sheet")!.getBoundingClientRect();
    const signatures = document.querySelector(".invoice-signatures")!.getBoundingClientRect();
    return { inside: signatures.bottom <= sheet.bottom + 0.5, long: document.querySelector(".invoice-sheet")!.classList.contains("long") };
  });
  expect(fit).toEqual({ inside: true, long: false });
  const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
  writeFileSync(`${SHOTS}/tax-invoice.pdf`, pdf);
  expect((pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(1);
  await page.emulateMedia({ media: "screen" });

  // A long invoice keeps every line at full size and flows onto a second page.
  const longInvoice = await page.request.post("/api/v5/tax-invoices", {
    data: {
      customerId: client.id, invoiceDate: (await state(page)).taxInvoices.find((i) => i.invoiceNumber === number)!.invoiceDate,
      customer: { companyNameEn: `${CLIENT} Co., Ltd.` }, exchangeRate: saved0.exchangeRateSource === "MANUAL" ? { rate: 4105, source: "MANUAL" } : undefined,
      items: Array.from({ length: 12 }, (_, i) => ({ description: `TEST long line ${i + 1}`, quantity: 1, unitPrice: 10 })),
    },
  });
  expect(longInvoice.ok()).toBeTruthy();
  const longId = ((await longInvoice.json()).data as { id: string }).id;
  await page.goto(`/office-v5/tax-invoices/${longId}`);
  await expect(page.getByTestId("tax-invoice-line")).toHaveCount(12);
  await page.emulateMedia({ media: "print" });
  const longPdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
  writeFileSync(`${SHOTS}/tax-invoice-long.pdf`, longPdf);
  expect((longPdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(2);
  await page.emulateMedia({ media: "screen" });
  await page.goto(invoiceUrl);

  /* --------------------------------------------------------- payments */
  await page.getByTestId("v5-invoice-payment-amount").fill("1300");
  await expect(page.getByTestId("v5-invoice-payment-add")).toBeDisabled(); // more than outstanding
  await page.getByTestId("v5-invoice-payment-amount").fill("800");
  await page.getByTestId("v5-invoice-payment-add").click();
  await expect(page.getByTestId("v5-outstanding")).toContainText("$437.60");
  await expect(page.getByTestId("v5-invoice-status")).toHaveText("Partly paid");

  /* ------------------------------------------------------------- edit */
  const rateBefore = (await state(page)).taxInvoices.find((i) => i.invoiceNumber === number)!.exchangeRate;
  await page.getByTestId("v5-invoice-edit").click();
  const edit = page.getByTestId("v5-invoice-editor");
  await expect(edit.getByTestId("v5-invoice-number")).toHaveText(number); // shown, not editable
  await expect(edit.getByTestId("v5-rate-source")).toHaveText("Kept from the saved invoice (date unchanged)");
  // A date with no stored rate asks for one; going back to the saved date restores the saved rate.
  const savedDate = await edit.getByTestId("v5-invoice-date").inputValue();
  await edit.getByTestId("v5-invoice-date").fill("2020-01-06");
  await expect(edit.getByTestId("v5-rate-none")).toBeVisible();
  await expect(edit.getByTestId("v5-rate-input")).toBeEnabled(); // entered by hand, no silent fallback
  await expect(edit.getByTestId("v5-rate-input")).toHaveValue("");
  await edit.getByTestId("v5-invoice-date").fill(savedDate);
  await expect(edit.getByTestId("v5-rate-source")).toHaveText("Kept from the saved invoice (date unchanged)");
  const freeIndex = await edit.locator('[data-testid^="v5-row-description-"]').evaluateAll((inputs, free) => inputs.findIndex((input) => (input as HTMLInputElement).value === free), FREE);
  await edit.getByTestId(`v5-row-price-${freeIndex}`).fill("60");
  await edit.getByTestId("v5-edit-reason").fill("TEST rush fee corrected");
  await edit.getByTestId("v5-issue").click();
  await expect(edit).toHaveCount(0);
  let saved = (await state(page)).taxInvoices.find((i) => i.invoiceNumber === number)!;
  expect([saved.exchangeRate, saved.revision, saved.totalUsd]).toEqual([rateBefore, 2, 1348.6]); // (1246 − 20) × 1.1
  await expect(page.getByTestId("v5-revision")).toHaveCount(2);
  await expect(page.getByTestId("v5-invoice-history")).toContainText("TEST rush fee corrected");
  await expect(page.getByTestId("v5-outstanding")).toContainText("$448.60");
  await page.getByTestId("v5-invoice-payment-amount").fill("448.60");
  await page.getByTestId("v5-invoice-payment-add").click();
  await expect(page.getByTestId("v5-invoice-status")).toHaveText("Collected");
  await expect(page.getByTestId("v5-outstanding")).toContainText("$0.00");
  await shot(page, "08-invoice-collected-en-light");

  /* --------------------------------------------------- partial billing */
  const left = async () => {
    const s = await state(page);
    return Math.round((1000 - s.billingAllocations.filter((a) => a.billingItemId === website.id && !a.voidedAt).reduce((sum, a) => sum + a.amount, 0)) * 100) / 100;
  };
  expect(await left()).toBe(700);
  await page.goto("/office-v5/accounting");
  await expect(row(WEBSITE)).toContainText("Partly invoiced $300.00 / $1,000.00");
  await expect(row(WEBSITE).getByTestId("v5-row-total")).toHaveText("$700.00");
  await expect(row(PROJECT)).toHaveCount(0); // fully invoiced
  const bill = (amount: number) =>
    page.request.post("/api/v5/tax-invoices", {
      data: {
        customerId: client.id, invoiceDate: savedDate, customer: { companyNameEn: `${CLIENT} Co., Ltd.` },
        exchangeRate: saved0.exchangeRateSource === "MANUAL" ? { rate, source: "MANUAL" } : undefined, items: [{ billingItemId: website.id, description: "Website", quantity: 1, unitPrice: amount, amount }],
      },
    });
  expect((await bill(300)).ok()).toBeTruthy();
  expect(await left()).toBe(400);
  const over = await bill(400.01);
  expect([over.status(), (await over.json()).code]).toEqual([409, "OVER_ALLOCATION"]);
  expect((await bill(400)).ok()).toBeTruthy();
  expect(await left()).toBe(0);
  const again = await bill(1);
  expect([again.status(), (await again.json()).code]).toEqual([409, "OVER_ALLOCATION"]); // no double billing
  await page.reload();
  await expect(row(WEBSITE)).toHaveCount(0);

  /* ----------------------------------------------------- invoice list */
  await page.getByRole("tab", { name: /Invoices/ }).click();
  await page.getByTestId("v5-invoice-search").fill(number);
  const listed = page.getByTestId("v5-issued-row").filter({ hasText: number });
  await expect(listed).toHaveCount(1);
  await expect(listed.getByTestId("v5-row-status")).toHaveText("Collected");
  await page.getByTestId("v5-invoice-search").fill(WEBSITE);
  await page.getByTestId("v5-invoice-status-filter").selectOption("UNPAID");
  await expect(page.getByTestId("v5-issued-row")).toHaveCount(2); // the two further website invoices
  await shot(page, "09-invoice-list-en-light");

  /* ------------------------------ masters edited later: invoice unchanged */
  const productId = (await state(page)).products.find((p) => p.description === PRODUCT)!.id;
  expect((await page.request.patch(`/api/v5/products/${productId}`, { data: { description: `${PRODUCT} XL`, defaultUnitPrice: 999 } })).ok()).toBeTruthy();
  expect((await page.request.patch(`/api/v5/customers/${client.id}`, { data: { companyNameEn: "TEST Renamed Co." } })).ok()).toBeTruthy();
  saved = (await state(page)).taxInvoices.find((i) => i.invoiceNumber === number)!;
  expect(saved.customer.companyNameEn).toBe(`${CLIENT} Co., Ltd.`);
  expect(saved.lines.map((l) => l.description)).toContain(PRODUCT);
  expect((await state(page)).products.some((p) => p.description === FREE)).toBe(true); // saved when asked

  /* -------------------------------------------- languages, themes, phone */
  for (const [locale, theme] of [["ja", "light"], ["ja", "dark"], ["en", "dark"], ["kh", "light"]] as const) {
    await prefs(page, locale, theme);
    for (const [path, name] of [["/office-v5", "billing"], ["/office-v5/accounting?view=invoices", "invoices"], ["/office-v5/accounting?view=customers", "customers"], [invoiceUrl, "invoice"]] as const) {
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("lang", locale === "kh" ? "km" : locale);
      if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
      await page.waitForLoadState("networkidle");
      await shot(page, `10-${name}-${locale}-${theme}`);
    }
  }
  await prefs(page, "ja", "light");
  await page.goto("/office-v5/accounting");
  await expect(page.getByRole("heading", { name: "経理" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [path, name] of [["/office-v5/accounting", "accounting"], ["/office-v5/accounting?view=invoices", "invoices"], [invoiceUrl, "invoice"]] as const) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${name} scrolls sideways`).toBeLessThanOrEqual(0);
    await shot(page, `11-${name}-phone`);
  }
  await page.setViewportSize({ width: 1360, height: 900 });
  await prefs(page, "en", "light");

  /* ------------------------------------------------------------ cleanup */
  if (DEPLOYED) {
    // Nothing is deleted: TEST payments are voided, TEST invoices cancelled
    // (they keep their TEST- numbers), TEST projects removed from Billing,
    // TEST customers and products deactivated.
    const s = await state(page);
    const testInvoices = s.taxInvoices.filter((i) => i.invoiceNumber.startsWith("TEST-") && [client.id, other.id].includes(i.clientId) && i.status === "ISSUED");
    for (const payment of s.invoicePayments.filter((p) => testInvoices.some((i) => i.id === p.invoiceId) && !p.voidedAt && p.kind === "PAYMENT")) {
      expect((await page.request.post(`/api/v5/invoice-payments/${payment.id}/void`, { data: { reason: "E2E test cleanup" } })).ok()).toBeTruthy();
    }
    for (const invoice of testInvoices) {
      if (s.invoicePayments.some((p) => p.invoiceId === invoice.id && p.kind === "DEPOSIT" && !p.voidedAt)) {
        const full = (await state(page)).taxInvoices.find((i) => i.id === invoice.id)!;
        const patched = await page.request.patch(`/api/v5/tax-invoices/${invoice.id}`, {
          data: { customerId: full.clientId, invoiceDate: full.invoiceDate, customer: full.customer, items: full.lines, discount: full.discount, vatApplicable: full.vatApplicable, depositUsd: 0, reason: "E2E test cleanup" },
        });
        expect(patched.ok()).toBeTruthy();
      }
      expect((await page.request.post(`/api/v5/tax-invoices/${invoice.id}/cancel`, { data: { reason: "E2E test cleanup" } })).ok()).toBeTruthy();
    }
    for (const project of (await state(page)).projects.filter((p) => [client.id, other.id].includes(p.clientId))) {
      expect((await page.request.delete(`/api/billing-v2/projects/${project.id}`)).ok()).toBeTruthy();
    }
    for (const id of [client.id, other.id]) expect((await page.request.patch(`/api/clients/${id}`, { data: { active: false } })).ok()).toBeTruthy();
    for (const product of (await state(page)).products.filter((p) => p.description.startsWith("TEST ") && p.description.includes(RUN))) {
      expect((await page.request.patch(`/api/v5/products/${product.id}`, { data: { active: false } })).ok()).toBeTruthy();
    }
  }

  // Imported records were only read.
  expect(await fingerprint()).toBe(importedBefore);
  expect(problems, problems.join("\n")).toEqual([]);
});

/* ======================================================================
 * Customer selector, customer codes, company documents, product selector,
 * unregistered products (TEST data only; documents are kept, never deleted).
 * ==================================================================== */
test("V5 masters in the invoice: customer selector, codes, company documents, product selector", async ({ page }) => {
  test.setTimeout(240_000);
  watch(page);
  const CUST = `TEST E2E Selector ${RUN}`;
  const EN = `${CUST} Co., Ltd.`;
  const KM = "ក្រុមហ៊ុន ជ្រើសរើស ឯ.ក";
  const ADDR_EN = "#8, Street 63, Phnom Penh";
  const ADDR_KM = "ផ្ទះលេខ ៨ ផ្លូវ៦៣ រាជធានីភ្នំពេញ";
  const PHONE = "023 111 222";
  const VATIN = "K009-987654321";
  const PICKED = `TEST Selector Product ${RUN}`;
  const YES = `TEST custom yes ${RUN}`;
  const NO = `TEST custom no ${RUN}`;

  await page.goto("/office-v5/accounting?view=customers");
  await prefs(page, "en", "light");
  await page.reload();

  /* ------------------------------------------ A. new customer, auto code */
  await page.getByTestId("v5-customer-new").click();
  let sheet = page.getByTestId("v5-customer-sheet");
  await expect(sheet.getByTestId("v5-customer-code")).toHaveText("Assigned when saved");
  await expect(sheet.locator('input[data-testid="v5-customer-code"]')).toHaveCount(0); // never typed
  await sheet.getByTestId("v5-customer-name").fill(CUST);
  await sheet.getByTestId("v5-customer-companyNameEn").fill(EN);
  await sheet.getByTestId("v5-customer-companyNameKm").fill(KM);
  await sheet.getByTestId("v5-customer-addressEn").fill(ADDR_EN);
  await sheet.getByTestId("v5-customer-addressKm").fill(ADDR_KM);
  await sheet.getByTestId("v5-customer-telephone").fill(PHONE);
  await sheet.getByTestId("v5-customer-vatin").fill(VATIN);
  await expect(sheet.getByTestId("v5-doc-empty")).toHaveCount(0); // documents come after the first save
  await sheet.getByTestId("v5-customer-save").click();
  await expect(sheet).toHaveCount(0);
  const customer = (await state(page)).customers.find((c) => c.companyNameEn === EN)!;
  expect(customer.customerCode).toMatch(/^C\d{4}$/);
  await page.getByTestId("v5-customer-search").fill(customer.customerCode);
  await expect(page.getByTestId("v5-customer-row")).toHaveCount(1);
  await page.getByTestId("v5-customer-row").click();
  sheet = page.getByTestId("v5-customer-sheet");
  await expect(sheet.getByTestId("v5-customer-code")).toHaveText(customer.customerCode);
  await expect(sheet.locator('input[data-testid="v5-customer-code"]')).toHaveCount(0);

  /* ------------------------------------------------- B. company documents */
  const pdf = Buffer.from(`%PDF-1.4\n% TEST patent tax ${RUN}\n%%EOF\n`);
  await sheet.getByTestId("v5-doc-type").selectOption("PATENT_TAX");
  await sheet.getByTestId("v5-doc-file").setInputFiles({ name: `TEST patent ${RUN}.pdf`, mimeType: "application/pdf", buffer: pdf });
  const docRow = sheet.getByTestId("v5-doc-row");
  await expect(docRow).toHaveCount(1);
  await expect(docRow).toContainText("Patent Tax");
  await expect(docRow.getByTestId("v5-doc-name")).toHaveText(`TEST patent ${RUN}.pdf`);
  const viewHref = (await docRow.getByTestId("v5-doc-view").getAttribute("href"))!;
  const viewed = await page.request.get(viewHref);
  expect([viewed.status(), viewed.headers()["content-type"], viewed.headers()["content-disposition"]?.split(";")[0], viewed.headers()["cache-control"]]).toEqual([200, "application/pdf", "inline", "private, no-store"]);
  expect(Buffer.from(await viewed.body()).equals(pdf)).toBe(true);
  const downloaded = await page.request.get((await docRow.getByTestId("v5-doc-download").getAttribute("href"))!);
  expect([downloaded.status(), downloaded.headers()["content-disposition"]?.split(";")[0]]).toEqual([200, "attachment"]);
  expect(Buffer.from(await downloaded.body()).equals(pdf)).toBe(true);
  // Replace: the new file is current, the old one kept in the history.
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const chooser = page.waitForEvent("filechooser");
  await docRow.getByTestId("v5-doc-replace").click();
  await (await chooser).setFiles({ name: `TEST patent ${RUN} v2.png`, mimeType: "image/png", buffer: png });
  await expect(sheet.getByTestId("v5-doc-name")).toHaveText(`TEST patent ${RUN} v2.png`);
  await expect(sheet.getByTestId("v5-doc-history")).toContainText("1 earlier version");
  const replaced = await page.request.get((await sheet.getByTestId("v5-doc-view").getAttribute("href"))!);
  expect([replaced.status(), replaced.headers()["content-type"]]).toEqual([200, "image/png"]);
  // The old file is still there (kept, not overwritten).
  expect(Buffer.from(await (await page.request.get(viewHref)).body()).equals(pdf)).toBe(true);
  await shot(page, "12-customer-documents-en-light");
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);

  /* --------------------------------------------------- C. a TEST product */
  await page.getByRole("tab", { name: /Products/ }).click();
  await page.getByTestId("v5-product-new").click();
  const productSheet = page.getByTestId("v5-product-sheet");
  await productSheet.getByTestId("v5-product-description").fill(PICKED);
  await productSheet.getByTestId("v5-product-price").fill("45");
  await productSheet.getByTestId("v5-product-unit").fill("pcs");
  await productSheet.getByTestId("v5-product-save").click();
  await expect(productSheet).toHaveCount(0);
  const product = (await state(page)).products.find((p) => p.description === PICKED)!;
  expect(product.productCode).toMatch(/^P\d{4}$/);

  /* ------------------------- A. selector → editor → issue → reopen → PDF */
  await page.getByRole("tab", { name: /Invoices/ }).click();
  await page.getByTestId("v5-invoice-new").click();
  const editor = page.getByTestId("v5-invoice-editor");
  const picker = editor.getByTestId("v5-editor-customer");
  await picker.fill(customer.customerCode); // search by code
  await expect(editor.getByTestId("v5-editor-customer-options").getByTestId("v5-editor-customer-option")).toHaveCount(1);
  await picker.fill(EN.slice(0, 18).toLowerCase()); // or by company name, any case
  await editor.getByTestId("v5-editor-customer-option").filter({ hasText: CUST }).click();
  await expect(picker).toHaveValue(`${customer.customerCode} · ${CUST}`);
  await expect(editor.getByTestId("v5-name-en")).toHaveValue(EN);
  await expect(editor.getByTestId("v5-name-km")).toHaveValue(KM);
  await expect(editor.getByTestId("v5-address-en")).toHaveValue(ADDR_EN);
  await expect(editor.getByTestId("v5-address-km")).toHaveValue(ADDR_KM);
  await expect(editor.getByTestId("v5-phone")).toHaveValue(PHONE);
  await expect(editor.getByTestId("v5-vatin")).toHaveValue(VATIN);

  // C. Product selector: search by code, pick → description, unit, unit price; qty × price.
  const line0 = editor.getByTestId("v5-row-description-0");
  await line0.fill(product.productCode);
  await editor.getByTestId("v5-row-description-0-option").filter({ hasText: PICKED }).click();
  await expect(line0).toHaveValue(PICKED);
  await expect(editor.getByTestId("v5-row-unit-0")).toHaveValue("pcs");
  await expect(editor.getByTestId("v5-row-price-0")).toHaveValue("45.00");
  await editor.getByTestId("v5-row-qty-0").fill("3");
  await expect(editor.getByTestId("v5-row-amount-0")).toHaveText("$135.00");
  await editor.getByTestId("v5-row-price-0").fill("44"); // still editable after picking
  await expect(editor.getByTestId("v5-row-amount-0")).toHaveText("$132.00");

  // D. Two lines that are not in the Product Master.
  await editor.getByTestId("v5-add-line").click();
  await editor.getByTestId("v5-row-description-1").fill(YES);
  await editor.getByTestId("v5-row-price-1").fill("10");
  await editor.getByTestId("v5-add-line").click();
  await editor.getByTestId("v5-row-description-2").fill(NO);
  await editor.getByTestId("v5-row-price-2").fill("5");
  const rateInput = editor.getByTestId("v5-rate-input");
  await expect(editor.getByTestId("v5-rate-source")).not.toHaveText("");
  if (!(await rateInput.inputValue())) await rateInput.fill("4105");
  await editor.getByTestId("v5-issue").click();
  const ask = page.getByTestId("v5-confirm-products");
  await expect(ask).toContainText(YES);
  await page.getByTestId("v5-confirm-products-confirm").click(); // YES: register
  await expect(ask).toContainText(NO);
  await page.getByTestId("v5-confirm-products-cancel").click(); // NO: this invoice only
  await page.getByTestId("v5-confirm-issue-confirm").click();

  await expect(page).toHaveURL(/\/office-v5\/tax-invoices\/[\w-]+$/);
  const number = (await page.getByTestId("v5-invoice-heading").innerText()).trim();
  expect(number).toMatch(/^TEST-CIJDTI\d{7}$/); // TEST series only
  const check = async () => {
    const doc = page.getByTestId("tax-invoice-sheet");
    for (const text of [EN, KM, ADDR_EN, ADDR_KM, PHONE, VATIN, PICKED, YES, NO]) await expect(doc).toContainText(text);
    await expect(doc.getByTestId("tax-invoice-line")).toHaveCount(3);
    await expect(doc.getByTestId("tax-invoice-subtotal")).toContainText("147.00"); // 132 + 10 + 5
    // Company documents never reach the Tax Invoice.
    await expect(doc).not.toContainText("patent");
    await expect(doc.locator("img")).toHaveCount(1); // the logo only
  };
  await check();
  await page.reload(); // reopen
  await check();
  const saved = (await state(page)).taxInvoices.find((i) => i.invoiceNumber === number)!;
  expect(saved.clientId).toBe(customer.id);
  expect(saved.customer).toMatchObject({ companyNameEn: EN, companyNameKm: KM, addressEn: ADDR_EN, addressKm: ADDR_KM, telephone: PHONE, vatin: VATIN });
  const products = (await state(page)).products;
  expect(products.some((p) => p.description === YES)).toBe(true);
  expect(products.some((p) => p.description === NO)).toBe(false);
  expect(saved.lines.map((l) => [l.description, !!l.productId])).toEqual([[PICKED, true], [YES, true], [NO, false]]);

  // A later Customer Master edit never reaches the issued invoice.
  expect((await page.request.patch(`/api/v5/customers/${customer.id}`, { data: { vatin: "K000-CHANGED" } })).ok()).toBeTruthy();
  expect((await state(page)).taxInvoices.find((i) => i.invoiceNumber === number)!.customer.vatin).toBe(VATIN);
  await page.getByTestId("tax-invoice-sheet").scrollIntoViewIfNeeded();
  await shot(page, "13-selector-invoice-en-light");

  if (DEPLOYED) {
    const s = await state(page);
    for (const invoice of s.taxInvoices.filter((i) => i.clientId === customer.id && i.status === "ISSUED")) {
      expect((await page.request.post(`/api/v5/tax-invoices/${invoice.id}/cancel`, { data: { reason: "E2E test cleanup" } })).ok()).toBeTruthy();
    }
    expect((await page.request.patch(`/api/v5/customers/${customer.id}`, { data: { active: false } })).ok()).toBeTruthy();
    for (const p of s.products.filter((entry) => entry.description.startsWith("TEST ") && entry.description.includes(RUN))) {
      expect((await page.request.patch(`/api/v5/products/${p.id}`, { data: { active: false } })).ok()).toBeTruthy();
    }
  }
  expect(problems, problems.join("\n")).toEqual([]);
});
