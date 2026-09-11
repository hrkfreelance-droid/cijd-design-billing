import { expect, test, type Page } from "@playwright/test";

/**
 * Billing V2 has two states: work waiting to be billed, and work that has been.
 * These tests walk the whole way through the screen a person actually uses —
 * open a project, price it, bill it, find it in Archive.
 */

async function signIn(page: Page, userId = "u_hiroki") {
  await page.addInitScript(() => {
    localStorage.setItem("cijd.locale", "en");
    localStorage.setItem("cijd.theme", "light");
  });
  const response = await page.request.post("/api/session", { data: { userId } });
  expect(response.ok()).toBeTruthy();
}

async function newProject(page: Page, name: string) {
  const created = await (
    await page.request.post("/api/projects", { data: { clientId: "cl_ringer_hut", name } })
  ).json();
  expect(created.ok).toBeTruthy();
  return created.data.id as string;
}

/** Opens the project modal from the Billing list by project name. */
async function openProject(page: Page, name: string) {
  await page.getByRole("button", { name: `Open ${name}` }).click();
  await expect(page.getByRole("dialog", { name })).toBeVisible();
}

async function markReady(page: Page, projectId: string) {
  const response = await page.request.patch(`/api/projects/${projectId}/readiness`, {
    data: { readiness: "READY" },
  });
  expect(response.ok()).toBeTruthy();
}

test("a project carries Design and Printing side by side", async ({ page }) => {
  await signIn(page);
  const projectId = await newProject(page, "V2 Combined");
  await page.request.post("/api/billing-items", {
    data: { projectId, description: "Design", type: "DESIGN", serviceType: "DESIGN", amount: 25 },
  });
  await page.request.post("/api/billing-items", {
    data: { projectId, description: "Print", type: "PRINT", serviceType: "PRINTING", printCost: 5 },
  });

  await page.goto("/office-v2");
  await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible();
  await openProject(page, "V2 Combined");

  const dialog = page.getByRole("dialog", { name: "V2 Combined" });
  await expect(dialog.getByTestId("v2-item")).toHaveCount(2);
  // Design keeps a plain price; Printing shows what the cost rule recommends.
  await expect(dialog.getByTestId("v2-item-final-0")).toHaveValue("25");
  await expect(dialog.getByTestId("v2-item-recommended-1")).toHaveText("$10.00");
  await expect(dialog.getByTestId("v2-item-final-1")).toHaveValue("10");
  await expect(dialog.getByTestId("v2-modal-total")).toHaveText("$35.00");
});

test("entering a cost recommends a price, and the recommendation follows the cost", async ({ page }) => {
  await signIn(page);
  const projectId = await newProject(page, "V2 Pricing");
  await page.request.post("/api/billing-items", {
    data: { projectId, description: "Print", type: "PRINT", serviceType: "PRINTING", printCost: 5 },
  });

  await page.goto("/office-v2");
  await openProject(page, "V2 Pricing");
  const dialog = page.getByRole("dialog", { name: "V2 Pricing" });

  for (const [cost, expected] of [
    ["5", "$10.00"],
    ["20", "$40.00"],
    ["50", "$100.00"],
    ["60", "$100.00"],
    ["101", "$145.00"],
  ] as const) {
    await dialog.getByTestId("v2-item-cost-0").fill(cost);
    await expect(dialog.getByTestId("v2-item-recommended-0")).toHaveText(expected);
    // With no price of its own, the final price follows the recommendation.
    await expect(dialog.getByTestId("v2-item-final-0")).toHaveValue(expected.replace(/[$,]/g, "").replace(/\.00$/, ""));
  }
});

test("a price set by hand survives a reload and a later cost change", async ({ page }) => {
  await signIn(page);
  const projectId = await newProject(page, "V2 Override");
  await page.request.post("/api/billing-items", {
    data: { projectId, description: "Print", type: "PRINT", serviceType: "PRINTING", printCost: 5 },
  });
  await markReady(page, projectId);

  await page.goto("/office-v2");
  await openProject(page, "V2 Override");
  let dialog = page.getByRole("dialog", { name: "V2 Override" });
  await dialog.getByTestId("v2-item-final-0").fill("15");
  await dialog.getByTestId("v2-modal-save").click();
  await expect(page.getByRole("dialog", { name: "V2 Override" })).toHaveCount(0);

  await page.reload();
  await openProject(page, "V2 Override");
  dialog = page.getByRole("dialog", { name: "V2 Override" });
  await expect(dialog.getByTestId("v2-item-recommended-0")).toHaveText("$10.00");
  await expect(dialog.getByTestId("v2-item-final-0")).toHaveValue("15");

  // The recommendation moves with the cost; the chosen price does not.
  await dialog.getByTestId("v2-item-cost-0").fill("20");
  await expect(dialog.getByTestId("v2-item-recommended-0")).toHaveText("$40.00");
  await expect(dialog.getByTestId("v2-item-final-0")).toHaveValue("15");
  await dialog.getByTestId("v2-modal-save").click();

  await page.reload();
  await openProject(page, "V2 Override");
  dialog = page.getByRole("dialog", { name: "V2 Override" });
  await expect(dialog.getByTestId("v2-item-recommended-0")).toHaveText("$40.00");
  await expect(dialog.getByTestId("v2-item-final-0")).toHaveValue("15");
});

test("without an override, a cost change moves the price with it", async ({ page }) => {
  await signIn(page);
  const projectId = await newProject(page, "V2 Follows");
  await page.request.post("/api/billing-items", {
    data: { projectId, description: "Print", type: "PRINT", serviceType: "PRINTING", printCost: 5 },
  });
  await markReady(page, projectId);

  await page.goto("/office-v2");
  await openProject(page, "V2 Follows");
  const dialog = page.getByRole("dialog", { name: "V2 Follows" });
  await dialog.getByTestId("v2-item-cost-0").fill("20");
  await dialog.getByTestId("v2-modal-save").click();

  await page.reload();
  await openProject(page, "V2 Follows");
  const reopened = page.getByRole("dialog", { name: "V2 Follows" });
  await expect(reopened.getByTestId("v2-item-recommended-0")).toHaveText("$40.00");
  await expect(reopened.getByTestId("v2-item-final-0")).toHaveValue("40");
});

test("selected work is billed in one step and lands in Archive", async ({ page }) => {
  await signIn(page);
  const projectId = await newProject(page, "V2 Billed");
  await page.request.post("/api/billing-items", {
    data: { projectId, description: "Design", type: "DESIGN", serviceType: "DESIGN", amount: 25 },
  });
  await page.request.post("/api/billing-items", {
    data: { projectId, description: "Print", type: "PRINT", serviceType: "PRINTING", printCost: 5 },
  });
  await markReady(page, projectId);

  await page.goto("/office-v2");
  const row = page.getByTestId("v2-project-row").filter({ hasText: "V2 Billed" });
  await expect(row.getByTestId("v2-project-total")).toHaveText("$35.00");
  await row.getByRole("checkbox").click();
  await expect(page.getByTestId("v2-selected-total")).toHaveText("$35.00");

  await page.getByTestId("v2-mark-billed").click();
  await page.getByRole("dialog", { name: "Mark as billed" }).getByRole("button", { name: "Mark as billed" }).click();

  await expect(page.getByTestId("v2-project-row").filter({ hasText: "V2 Billed" })).toHaveCount(0);

  await page.goto("/office-v2/archive");
  const archived = page.getByTestId("v2-archive-row").filter({ hasText: "V2 Billed" });
  await expect(archived).toHaveCount(1);
  await expect(archived).toContainText("$35.00");

  // Archive shows the work, and does not offer to change it.
  await archived.getByRole("button").click();
  const detail = page.getByRole("dialog", { name: "V2 Billed" });
  await expect(detail).toContainText("Archive is a record");
  await expect(detail.getByTestId("v2-item")).toHaveCount(0);
});

test("adding and removing items inside the modal keeps the totals honest", async ({ page }) => {
  await signIn(page);
  await newProject(page, "V2 Items");

  await page.goto("/office-v2");
  // A project with no items is not waiting to be billed, so it is added from
  // inside its own modal after being created.
  const projectId = await newProject(page, "V2 Items Seeded");
  await page.request.post("/api/billing-items", {
    data: { projectId, description: "Design", type: "DESIGN", serviceType: "DESIGN", amount: 25 },
  });
  await markReady(page, projectId);
  await page.reload();
  await openProject(page, "V2 Items Seeded");
  const dialog = page.getByRole("dialog", { name: "V2 Items Seeded" });

  await dialog.getByTestId("v2-add-item").click();
  await dialog.getByTestId("v2-item-service-1").selectOption("PRINTING");
  await dialog.getByTestId("v2-item-description-1").fill("Print run");
  await dialog.getByTestId("v2-item-cost-1").fill("50");
  await expect(dialog.getByTestId("v2-item-recommended-1")).toHaveText("$100.00");
  await expect(dialog.getByTestId("v2-modal-total")).toHaveText("$125.00");
  await dialog.getByTestId("v2-modal-save").click();

  await page.reload();
  const row = page.getByTestId("v2-project-row").filter({ hasText: "V2 Items Seeded" });
  await expect(row.getByTestId("v2-project-total")).toHaveText("$125.00");

  // Removing a line asks once, because it cannot be undone.
  await openProject(page, "V2 Items Seeded");
  const reopened = page.getByRole("dialog", { name: "V2 Items Seeded" });
  await reopened.getByTestId("v2-item-remove-1").click();
  await page.getByRole("dialog", { name: "Remove" }).getByRole("button", { name: "Remove" }).click();
  await expect(reopened.getByTestId("v2-modal-total")).toHaveText("$25.00");
  await reopened.getByTestId("v2-modal-save").click();

  await page.reload();
  await expect(
    page.getByTestId("v2-project-row").filter({ hasText: "V2 Items Seeded" }).getByTestId("v2-project-total"),
  ).toHaveText("$25.00");
});

test("Billing V2 keeps the three languages", async ({ page }) => {
  await signIn(page);
  await page.goto("/office-v2");
  await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible();
  for (const [code, heading] of [["ja", "請求待ち"], ["kh", "រង់ចាំចេញវិក្កយបត្រ"]] as const) {
    await page.getByRole("button", { name: code === "ja" ? "日本語" : "ខ្មែរ" }).click();
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
  }
});
