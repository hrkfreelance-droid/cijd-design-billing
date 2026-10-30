import { expect, test } from "@playwright/test";

/** Test only against the isolated local Worker; never mutate the live billing data. */
test.skip(!!process.env.V5_BASE_URL, "Local-only No invoice and deletion tests.");

test("No invoice: clear issue action, no Tax Invoice, reversible from Accounting", async ({ page }) => {
  const name = `TEST No invoice UI ${Date.now()}`;
  const c = await page.request.post("/api/clients", { data: { name } });
  expect(c.ok()).toBeTruthy();
  const client = (await c.json()).data as { id: string };
  const p = await page.request.post("/api/projects", { data: { clientId: client.id, name } });
  expect(p.ok()).toBeTruthy();
  const project = (await p.json()).data as { id: string };
  const b = await page.request.post("/api/billing-items", {
    data: { projectId: project.id, description: "Graphics", type: "DESIGN", quantity: 1, amount: 75, finalMode: "MANUAL" },
  });
  expect(b.ok()).toBeTruthy();
  for (const readiness of ["READY", "ACCOUNTING"]) {
    const response = await page.request.patch(`/api/projects/${project.id}/readiness`, { data: { readiness } });
    expect(response.ok()).toBeTruthy();
  }

  const before = (await (await page.request.get("/api/state")).json()).data as { taxInvoices: unknown[] };
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/office-v5/accounting");
  const row = page.getByTestId("v5-accounting-row").filter({ hasText: name });
  await expect(row).toBeVisible();
  await expect(row.getByTestId("v5-delete-project")).toBeVisible();
  await row.getByTestId("v5-select-project").click();
  await expect(page.getByTestId("v5-mark-no-invoice")).toBeVisible();
  await page.getByTestId("v5-mark-no-invoice").click();
  await expect(page.getByTestId("v5-confirm-no-invoice")).toContainText("No invoice");
  await page.getByTestId("v5-confirm-no-invoice-confirm").click();
  await expect(row).toHaveCount(0);
  await expect(page.getByTestId("v5-no-invoice-row").filter({ hasText: name })).toBeVisible();
  const after = (await (await page.request.get("/api/state")).json()).data as {
    taxInvoices: unknown[]; invoicePayments: unknown[]; noInvoiceIssues: { id: string; clientId: string; status: string }[];
  };
  expect(after.taxInvoices.length).toBe(before.taxInvoices.length);
  expect(after.noInvoiceIssues.some((issue) => issue.clientId === client.id && issue.status === "ISSUED")).toBeTruthy();

  const issued = page.getByTestId("v5-no-invoice-row").filter({ hasText: name });
  await issued.getByTestId("v5-reverse-no-invoice").click();
  await expect(page.getByTestId("v5-confirm-reverse-no-invoice")).toBeVisible();
  await page.getByTestId("v5-confirm-reverse-no-invoice-confirm").click();
  await expect(row).toBeVisible();
  expect(errors).toEqual([]);
});

test("Delete from Accounting: clear button, confirmation, soft-delete only for new project", async ({ page }) => {
  const name = `TEST Delete UI ${Date.now()}`;
  const c = await page.request.post("/api/clients", { data: { name } });
  const client = (await c.json()).data as { id: string };
  const p = await page.request.post("/api/projects", { data: { clientId: client.id, name } });
  const project = (await p.json()).data as { id: string };
  const b = await page.request.post("/api/billing-items", {
    data: { projectId: project.id, description: "Card", type: "DESIGN", quantity: 1, amount: 20, finalMode: "MANUAL" },
  });
  expect(b.ok()).toBeTruthy();
  for (const readiness of ["READY", "ACCOUNTING"]) {
    expect((await page.request.patch(`/api/projects/${project.id}/readiness`, { data: { readiness } })).ok()).toBeTruthy();
  }
  await page.goto("/office-v5/accounting");
  const row = page.getByTestId("v5-accounting-row").filter({ hasText: name });
  await expect(row).toBeVisible();
  await row.getByTestId("v5-delete-project").click();
  await expect(page.getByTestId("v5-confirm-project-delete")).toBeVisible();
  await page.getByTestId("v5-confirm-project-delete-cancel").click();
  await expect(row).toBeVisible();
  await row.getByTestId("v5-delete-project").click();
  await page.getByTestId("v5-confirm-project-delete-confirm").click();
  await expect(row).toHaveCount(0);
  const after = (await (await page.request.get("/api/state")).json()).data as { projects: { id: string }[] };
  expect(after.projects.some((entry) => entry.id === project.id)).toBe(false);
});
