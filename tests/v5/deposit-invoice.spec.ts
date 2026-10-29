import { expect, test, type Page } from "@playwright/test";

const RUN = Date.now().toString(36).slice(-5);
const CLIENT = `TEST Deposit E2E ${RUN}`;
const PROJECT = `TEST Deposit project ${RUN}`;

async function readyProject(page: Page, clientId: string) {
  const project = (await (await page.request.post("/api/projects", { data: { clientId, name: PROJECT } })).json()).data as { id: string };
  const billing = await page.request.post("/api/billing-items", {
    data: { projectId: project.id, description: "Contract design", type: "DESIGN", serviceType: "DESIGN", quantity: 1, amount: 200, finalMode: "MANUAL" },
  });
  expect(billing.ok()).toBeTruthy();
  for (const readiness of ["READY", "ACCOUNTING"]) {
    const response = await page.request.patch(`/api/projects/${project.id}/readiness`, { data: { readiness } });
    expect(response.ok()).toBeTruthy();
  }
}

async function selectProject(page: Page) {
  await page.goto("/office-v5/accounting?view=to-invoice");
  const projectRow = page.getByTestId("v5-accounting-row").filter({ hasText: PROJECT });
  await expect(projectRow).toBeVisible();
  await projectRow.getByTestId("v5-select-project").click();
  await page.getByTestId("v5-create-invoice").click();
  return page.getByTestId("v5-invoice-editor");
}

test("fixed deposit tax invoice and final remainder reconcile in the V5 UI", async ({ page }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.stack ?? error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  const created = await page.request.post("/api/clients", { data: { name: CLIENT } });
  expect(created.ok()).toBeTruthy();
  const client = (await created.json()).data as { id: string };
  await readyProject(page, client.id);

  let editor = await selectProject(page);
  await editor.getByTestId("v5-invoice-kind").selectOption("DEPOSIT_FIXED");
  await expect(editor.getByTestId("v5-deposit-value")).toBeVisible();
  await editor.getByTestId("v5-deposit-value").fill("100");
  const rate = editor.getByTestId("v5-rate-input");
  await expect.poll(async () => (await rate.inputValue()) || ((await editor.getByTestId("v5-rate-none").count()) ? "manual" : "")).not.toBe("");
  if (await rate.inputValue()) {
    await expect(rate).toBeDisabled();
  } else {
    await expect(editor.getByTestId("v5-rate-none")).toBeVisible();
    await rate.fill("4105");
  }
  await expect(editor.getByTestId("v5-total-usd")).toHaveText("$110.00");
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(editor.getByText("DEPOSIT TAX INVOICE")).toBeVisible();
  await expect(editor.getByText("Advance portion: Contract design")).toBeVisible();
  await expect(editor.getByTestId("tax-invoice-total-usd")).toContainText("110.00");
  await page.getByRole("button", { name: "Issue Tax Invoice" }).click();
  await page.getByTestId("v5-confirm-issue-confirm").click();

  await expect(page).toHaveURL(/\/office-v5\/tax-invoices\/[\w-]+$/);
  const depositId = page.url().split("/").at(-1)!;
  const depositState = (await (await page.request.get("/api/state")).json()).data as {
    taxInvoices: { id: string; invoiceNumber: string; subtotalUsd: number; vatUsd: number; totalUsd: number; contractId?: string; invoiceKind?: string }[];
    billingItems: { id: string; projectId: string }[];
  };
  const deposit = depositState.taxInvoices.find((invoice) => invoice.id === depositId)!;
  expect(deposit).toMatchObject({ invoiceKind: "DEPOSIT_FIXED", subtotalUsd: 100, vatUsd: 10, totalUsd: 110 });
  expect(deposit.contractId).toBeTruthy();
  await expect(page.getByTestId("v5-invoice-kind")).toContainText("DEPOSIT");
  const payment = await page.request.post(`/api/v5/tax-invoices/${depositId}/payments`, { data: { amount: 100, paidOn: "2026-10-29", note: "TEST deposit payment" } });
  expect(payment.ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByTestId("v5-outstanding")).toContainText("$10.00");

  editor = await selectProject(page);
  await editor.getByTestId("v5-invoice-kind").selectOption("FINAL");
  await editor.getByTestId("v5-contract-select").selectOption(deposit.contractId!);
  await expect(editor.getByTestId("v5-total-usd")).toHaveText("$110.00");
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(editor.getByText("FINAL TAX INVOICE")).toBeVisible();
  await expect(editor.getByTestId("tax-invoice-deposit-reference")).toContainText(deposit.invoiceNumber);
  await expect(editor.getByTestId("tax-invoice-subtotal")).toContainText("100.00");
  await expect(editor.getByTestId("tax-invoice-vat")).toContainText("10.00");
  await page.getByRole("button", { name: "Issue Tax Invoice" }).click();
  await page.getByTestId("v5-confirm-issue-confirm").click();

  await expect(page).toHaveURL(/\/office-v5\/tax-invoices\/[\w-]+$/);
  const finalId = page.url().split("/").at(-1)!;
  const finalState = (await (await page.request.get("/api/state")).json()).data as {
    taxInvoices: { id: string; invoiceNumber: string; subtotalUsd: number; vatUsd: number; totalUsd: number; invoiceKind?: string; depositReferences?: { invoiceNumber: string }[] }[];
    invoicePayments: { invoiceId: string; kind: string; amount: number; voidedAt?: string | null }[];
  };
  const final = finalState.taxInvoices.find((invoice) => invoice.id === finalId)!;
  expect(final).toMatchObject({ invoiceKind: "FINAL", subtotalUsd: 100, vatUsd: 10, totalUsd: 110 });
  expect(final.depositReferences?.map((reference) => reference.invoiceNumber)).toEqual([deposit.invoiceNumber]);
  expect(finalState.invoicePayments.filter((entry) => !entry.voidedAt && entry.kind === "PAYMENT" && entry.invoiceId === finalId)).toHaveLength(0);
  expect(finalState.invoicePayments.some((entry) => !entry.voidedAt && entry.invoiceId === depositId && entry.amount === 100)).toBe(true);
  await expect(page.getByTestId("v5-invoice-kind")).toContainText("FINAL");
  await expect(page.getByTestId("v5-outstanding")).toContainText("$110.00");
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileFits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(mobileFits).toBe(true);
  await page.emulateMedia({ media: "print" });
  const signatureFits = await page.evaluate(() => {
    const sheet = document.querySelector(".invoice-sheet")!.getBoundingClientRect();
    const signatures = document.querySelector(".invoice-signatures")!.getBoundingClientRect();
    return signatures.bottom <= sheet.bottom + 0.5;
  });
  expect(signatureFits).toBe(true);
  const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
  expect((pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(1);
  await page.emulateMedia({ media: "screen" });
  expect(browserErrors).toEqual([]);
});
