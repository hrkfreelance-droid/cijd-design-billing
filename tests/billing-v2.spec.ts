import { expect, test, type Page } from "@playwright/test";

/**
 * Billing V2 end to end, on the throwaway local store: the list a billing
 * person reads, the read-only detail, editing, readiness, billing, Archive and
 * back. Nothing here touches the shared database.
 */

async function signIn(page: Page, userId = "u_admin") {
  await page.addInitScript(() => {
    localStorage.setItem("cijd.locale", "en");
    localStorage.setItem("cijd.theme", "light");
  });
  const response = await page.request.post("/api/session", { data: { userId } });
  expect(response.ok()).toBeTruthy();
}

async function clientId(page: Page, name = "Ringer Hut") {
  const state = await (await page.request.get("/api/state")).json();
  return state.data.clients.find((client: { name: string }) => client.name === name).id as string;
}

async function newProject(page: Page, name: string) {
  const created = await (
    await page.request.post("/api/projects", { data: { clientId: await clientId(page), name } })
  ).json();
  expect(created.ok).toBeTruthy();
  return created.data.id as string;
}

async function addItem(page: Page, projectId: string, data: Record<string, unknown>) {
  const response = await page.request.post("/api/billing-items", { data: { projectId, ...data } });
  expect(response.ok()).toBeTruthy();
}

async function markReady(page: Page, projectId: string) {
  const response = await page.request.patch(`/api/projects/${projectId}/readiness`, {
    data: { readiness: "READY" },
  });
  expect(response.ok()).toBeTruthy();
}

const row = (page: Page, name: string) => page.getByTestId("v2-project-row").filter({ hasText: name });

async function openProject(page: Page, name: string) {
  await page.getByRole("button", { name: `Open ${name}` }).click();
  const dialog = page.getByRole("dialog", { name });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function edit(page: Page, name: string) {
  const dialog = await openProject(page, name);
  await dialog.getByTestId("v2-modal-edit").click();
  await expect(dialog.getByTestId("v2-edit-mode")).toBeVisible();
  return dialog;
}

test("the list shows every line with its price, and the detail is read-only", async ({ page }) => {
  await signIn(page);
  const projectId = await newProject(page, "V2 Combined");
  await addItem(page, projectId, { description: "Revision", type: "DESIGN", serviceType: "DESIGN", amount: 10 });
  await addItem(page, projectId, {
    description: "Print x900",
    type: "PRINT",
    serviceType: "PRINTING",
    quantity: 900,
    printCost: 30,
  });
  await markReady(page, projectId);

  await page.goto("/office-v2");
  await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible();
  await expect(page.getByTestId("v2-brand")).toHaveText("CIJD Billing");

  const listed = row(page, "V2 Combined");
  await expect(listed.getByTestId("v2-project-total")).toHaveText("$70.00");
  await expect(listed.getByTestId("v2-line-item")).toHaveCount(2);
  await expect(listed).toContainText("Printing · Print x900");
  await expect(listed).toContainText("Cost $30.00");
  await expect(listed).toContainText("$60.00");

  const dialog = await openProject(page, "V2 Combined");
  await expect(dialog.getByTestId("v2-view-mode")).toBeVisible();
  await expect(dialog.locator("input, select, textarea")).toHaveCount(0);
  await expect(dialog.getByTestId("v2-view-project-total")).toHaveText("$70.00");
  await expect(dialog).toContainText("Recommended");
  await expect(dialog).toContainText("50% margin");
});

test("a cost recommends a price on the $5 step, and the price follows it", async ({ page }) => {
  await signIn(page);
  const projectId = await newProject(page, "V2 Pricing");
  await addItem(page, projectId, { description: "Print", type: "PRINT", serviceType: "PRINTING", printCost: 5 });

  await page.goto("/office-v2");
  const dialog = await edit(page, "V2 Pricing");
  for (const [cost, expected] of [
    ["5", "10"],
    ["20", "40"],
    ["50", "100"],
    ["60", "100"],
    ["101", "145"],
  ] as const) {
    await dialog.getByTestId("v2-item-cost-0").fill(cost);
    await expect(dialog.getByTestId("v2-item-recommended-0")).toHaveText(`$${expected}.00`);
    await expect(dialog.getByTestId("v2-item-final-0")).toHaveValue(expected);
  }
});

test("a price set by hand survives a reload and a later cost change", async ({ page }) => {
  await signIn(page);
  const projectId = await newProject(page, "V2 Override");
  await addItem(page, projectId, { description: "Print", type: "PRINT", serviceType: "PRINTING", printCost: 5 });

  await page.goto("/office-v2");
  let dialog = await edit(page, "V2 Override");
  await dialog.getByTestId("v2-item-final-0").fill("15");
  await dialog.getByTestId("v2-modal-save").click();
  // Save keeps the project open and returns to the detail.
  await expect(dialog.getByTestId("v2-view-mode")).toBeVisible();
  await expect(dialog).toContainText("Set by hand");

  await page.reload();
  dialog = await edit(page, "V2 Override");
  await expect(dialog.getByTestId("v2-item-final-0")).toHaveValue("15");
  await dialog.getByTestId("v2-item-cost-0").fill("20");
  await expect(dialog.getByTestId("v2-item-recommended-0")).toHaveText("$40.00");
  await expect(dialog.getByTestId("v2-item-final-0")).toHaveValue("15");
  await dialog.getByTestId("v2-modal-save").click();
  await expect(dialog.getByTestId("v2-view-mode")).toBeVisible();

  await page.reload();
  dialog = await edit(page, "V2 Override");
  await expect(dialog.getByTestId("v2-item-recommended-0")).toHaveText("$40.00");
  await expect(dialog.getByTestId("v2-item-final-0")).toHaveValue("15");
});

test("without an override, a saved cost change moves the price with it", async ({ page }) => {
  await signIn(page);
  const projectId = await newProject(page, "V2 Follows");
  await addItem(page, projectId, { description: "Print", type: "PRINT", serviceType: "PRINTING", printCost: 5 });

  await page.goto("/office-v2");
  const dialog = await edit(page, "V2 Follows");
  await dialog.getByTestId("v2-item-cost-0").fill("20");
  await dialog.getByTestId("v2-modal-save").click();
  await expect(dialog.getByTestId("v2-view-mode")).toBeVisible();

  await page.reload();
  await expect(row(page, "V2 Follows").getByTestId("v2-project-total")).toHaveText("$40.00");
});

test("a missing price is 'Price pending', never $0, and holds the project back", async ({ page }) => {
  await signIn(page);
  const projectId = await newProject(page, "V2 Pending");
  await addItem(page, projectId, { description: "Menu design", type: "DESIGN", serviceType: "DESIGN" });

  await page.goto("/office-v2");
  const listed = page.getByTestId("v2-section-in-progress").getByTestId("v2-project-row").filter({ hasText: "V2 Pending" });
  await expect(listed).toContainText("1 price pending");
  await expect(listed).toContainText("Price pending");

  let dialog = await openProject(page, "V2 Pending");
  await expect(dialog.getByTestId("v2-mark-ready")).toBeDisabled();
  await expect(dialog).toContainText("Set every price before marking it ready.");

  await dialog.getByTestId("v2-modal-edit").click();
  await dialog.getByTestId("v2-item-final-0").fill("0");
  await dialog.getByTestId("v2-modal-save").click();
  await expect(dialog.getByTestId("v2-view-mode")).toBeVisible();
  await expect(dialog.getByTestId("v2-view-project-total")).toHaveText("$0.00");
  await dialog.getByTestId("v2-mark-ready").click();
  await expect(dialog.getByTestId("v2-view-status")).toHaveText("Ready to bill");

  await page.reload();
  dialog = await openProject(page, "V2 Pending");
  await expect(dialog.getByTestId("v2-view-status")).toHaveText("Ready to bill");
});

test("a new project needs only a client and a name, and a client can be added in place", async ({ page }) => {
  await signIn(page);
  await page.goto("/office-v2");
  await page.getByTestId("v2-new-project").click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByTestId("v2-new-project-client").selectOption("__new__");
  await dialog.getByTestId("v2-new-client-name").fill("ZZ E2E Client");
  await dialog.getByTestId("v2-new-project-name").fill("ZZ E2E Project");
  await dialog.getByTestId("v2-create-project").click();
  await expect(dialog).toHaveCount(0);

  const inProgress = page.getByTestId("v2-section-in-progress");
  await expect(inProgress).toContainText("ZZ E2E Client");
  await expect(inProgress.getByTestId("v2-project-row").filter({ hasText: "ZZ E2E Project" })).toContainText(
    "No services yet",
  );

  await page.reload();
  await page.getByTestId("v2-new-project").click();
  await expect(page.getByTestId("v2-new-project-client").locator("option", { hasText: "ZZ E2E Client" })).toHaveCount(1);
});

test("a service can be added from the picker and used straight away", async ({ page }) => {
  await signIn(page);
  await newProject(page, "V2 Service");
  await page.goto("/office-v2");
  const dialog = await edit(page, "V2 Service");
  await dialog.getByTestId("v2-item-service-0").selectOption("__new__");
  await dialog.getByTestId("v2-new-service-name").fill("Translation");
  await dialog.getByTestId("v2-new-service-add").click();
  await expect(dialog.getByTestId("v2-item-service-0")).toHaveValue("TRANSLATION");
  await dialog.getByTestId("v2-item-final-0").fill("30");
  await dialog.getByTestId("v2-modal-save").click();
  await expect(dialog.getByTestId("v2-view-mode")).toContainText("Translation");
});

test("editing a ready project keeps it ready, and it bills, archives and comes back", async ({ page }) => {
  await signIn(page);
  const projectId = await newProject(page, "V2 Billed");
  await addItem(page, projectId, { description: "Design", type: "DESIGN", serviceType: "DESIGN", amount: 25 });
  await markReady(page, projectId);

  await page.goto("/office-v2");
  const dialog = await edit(page, "V2 Billed");
  await dialog.getByTestId("v2-add-item").click();
  await dialog.getByTestId("v2-item-service-1").selectOption("PRINTING");
  await dialog.getByTestId("v2-item-description-1").fill("Print run");
  await dialog.getByTestId("v2-item-cost-1").fill("50");
  await expect(dialog.getByTestId("v2-modal-total")).toHaveText("$125.00");
  await dialog.getByTestId("v2-modal-save").click();
  await expect(dialog.getByTestId("v2-view-mode")).toBeVisible();
  await expect(dialog.getByTestId("v2-view-status")).toHaveText("Ready to bill");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);

  const listed = page.getByTestId("v2-section-ready").getByTestId("v2-project-row").filter({ hasText: "V2 Billed" });
  await listed.getByRole("checkbox").click();
  await expect(page.getByTestId("v2-selected-total")).toHaveText("$125.00");
  await page.getByTestId("v2-mark-billed").click();
  await page.getByTestId("v2-confirm-bill-confirm").click();
  await expect(row(page, "V2 Billed")).toHaveCount(0);

  await page.goto("/office-v2/archive");
  const archived = page.getByTestId("v2-archive-row").filter({ hasText: "V2 Billed" });
  await expect(archived).toContainText("$125.00");
  await archived.getByRole("button").click();
  const detail = page.getByRole("dialog", { name: "V2 Billed" });
  await expect(detail.locator("input, select, textarea")).toHaveCount(0);
  await detail.getByTestId("v2-restore").click();
  await page.getByTestId("v2-confirm-restore-confirm").click();
  await expect(page.getByTestId("v2-archive-row").filter({ hasText: "V2 Billed" })).toHaveCount(0);

  await page.goto("/office-v2");
  await expect(
    page.getByTestId("v2-section-ready").getByTestId("v2-project-row").filter({ hasText: "V2 Billed" }),
  ).toHaveCount(1);
});

test("removing a line waits for Save and can be undone; deleting a project asks once", async ({ page }) => {
  await signIn(page);
  const projectId = await newProject(page, "V2 Items");
  await addItem(page, projectId, { description: "Design", type: "DESIGN", serviceType: "DESIGN", amount: 25 });
  await addItem(page, projectId, { description: "Extra", type: "DESIGN", serviceType: "DESIGN", amount: 5 });

  await page.goto("/office-v2");
  const dialog = await edit(page, "V2 Items");
  await dialog.getByTestId("v2-item-remove-1").click();
  await expect(dialog.getByTestId("v2-item-removed")).toBeVisible();
  await expect(dialog.getByTestId("v2-modal-total")).toHaveText("$25.00");
  await dialog.getByTestId("v2-item-undo-1").click();
  await expect(dialog.getByTestId("v2-modal-total")).toHaveText("$30.00");
  await dialog.getByTestId("v2-item-remove-1").click();
  await dialog.getByTestId("v2-modal-save").click();
  await expect(dialog.getByTestId("v2-view-mode")).toBeVisible();
  await expect(dialog.getByTestId("v2-view-item")).toHaveCount(1);

  await dialog.getByTestId("v2-modal-edit").click();
  await dialog.getByTestId("v2-delete-project").click();
  await page.getByTestId("v2-confirm-delete-confirm").click();
  await expect(page.getByRole("dialog", { name: "V2 Items" })).toHaveCount(0);
  await page.reload();
  await expect(row(page, "V2 Items")).toHaveCount(0);
});

test("Billing V2 keeps the three languages", async ({ page }) => {
  await signIn(page);
  await page.goto("/office-v2");
  await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible();
  for (const [code, heading] of [["ja", "請求"], ["kh", "វិក្កយបត្រ"]] as const) {
    await page.getByRole("button", { name: code === "ja" ? "日本語" : "ខ្មែរ" }).click();
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    await expect(page.getByTestId("v2-brand")).toHaveText("CIJD Billing");
  }
});

test("on a phone the project opens as a sheet whose footer stays on screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  const projectId = await newProject(page, "V2 Phone");
  for (let index = 0; index < 8; index += 1) {
    await addItem(page, projectId, { description: `Line ${index}`, type: "DESIGN", serviceType: "DESIGN", amount: 5 });
  }

  await page.goto("/office-v2");
  const dialog = await edit(page, "V2 Phone");
  const scroller = page.locator("[data-daishin-sheet-scroll]");
  await scroller.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
  const save = page.getByTestId("v2-modal-save");
  await expect(save).toBeInViewport();
  const box = await save.boundingBox();
  expect(box && box.y + box.height).toBeLessThanOrEqual(844);
  await expect(dialog).toBeVisible();
});
