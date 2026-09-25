import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Billing V3 pricing, end to end on the throwaway local store: markup,
 * Recommended, Final overrides, the Qty regression, and the project deposit.
 * Nothing here touches the shared database.
 */

const SHOTS = process.env.CIJD_SHOTS_DIR;

async function signIn(page: Page, userId = "u_admin") {
  await page.addInitScript(() => {
    localStorage.setItem("cijd.locale", "en");
    localStorage.setItem("cijd.theme", "light");
  });
  const response = await page.request.post("/api/session", { data: { userId } });
  expect(response.ok()).toBeTruthy();
}

async function state(page: Page) {
  return (await (await page.request.get("/api/state")).json()).data as {
    clients: { id: string; name: string }[];
    projects: { id: string; depositAmount?: number | null }[];
    billingItems: {
      id: string;
      projectId: string;
      quantity: number;
      unitPrice: number;
      amount: number | null;
      markupOverride?: number | null;
    }[];
  };
}

async function newProject(page: Page, name: string) {
  const clientId = (await state(page)).clients.find((client) => client.name === "Ringer Hut")!.id;
  const created = await (await page.request.post("/api/projects", { data: { clientId, name } })).json();
  expect(created.ok).toBeTruthy();
  return created.data.id as string;
}

async function addItem(page: Page, projectId: string, data: Record<string, unknown>) {
  const response = await page.request.post("/api/billing-items", { data: { projectId, ...data } });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).data.id as string;
}

async function edit(page: Page, name: string): Promise<Locator> {
  await page.goto("/office-v3");
  await page.getByRole("button", { name: `Open ${name}` }).click();
  const dialog = page.getByRole("dialog", { name });
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("v2-modal-edit").click();
  await expect(dialog.getByTestId("v2-edit-mode")).toBeVisible();
  return dialog;
}

async function save(dialog: Locator) {
  await dialog.getByTestId("v2-modal-save").click();
  await expect(dialog.getByTestId("v2-view-mode")).toBeVisible();
}

test("markup is editable, Recommended stays a reference, Final Total can be typed", async ({ page }) => {
  await signIn(page);
  const projectId = await newProject(page, "V3 Markup");
  await addItem(page, projectId, { description: "Flyers", type: "PRINT", serviceType: "PRINTING", quantity: 1, printCost: 40 });

  const dialog = await edit(page, "V3 Markup");
  await expect(dialog.getByTestId("v2-item-recommended-0")).toHaveText("$60.00");
  await expect(dialog.getByTestId("v3-item-markup-0")).toHaveValue("50");
  await expect(dialog.getByTestId("v3-item-markup-default-0")).toBeVisible();
  await expect(dialog.getByTestId("v3-item-final-mode-0")).toHaveAttribute("data-mode", "auto");

  // Manual markup: Recommended recalculates and an AUTO Final follows it.
  await dialog.getByTestId("v3-item-markup-0").fill("35");
  await expect(dialog.getByTestId("v2-item-recommended-0")).toHaveText("$54.00");
  await expect(dialog.getByTestId("v2-item-final-0")).toHaveValue("54.00");
  await dialog.getByTestId("v3-item-markup-reset-0").click();
  await expect(dialog.getByTestId("v3-item-markup-0")).toHaveValue("50");
  await expect(dialog.getByTestId("v2-item-final-0")).toHaveValue("60.00");

  // Final Total typed directly: unit and effective markup derived.
  await dialog.getByTestId("v2-item-final-0").fill("55");
  await expect(dialog.getByTestId("v3-item-final-unit-0")).toHaveValue("55.00");
  await expect(dialog.getByTestId("v3-item-effective-markup-0")).toHaveText("+37.5% effective markup");
  await expect(dialog.getByTestId("v3-item-final-mode-0")).toHaveAttribute("data-mode", "manual");
  await expect(dialog.getByTestId("v2-item-recommended-0")).toHaveText("$60.00");

  // A cost change moves Recommended, never a manual Final.
  await dialog.getByTestId("v2-item-unit-cost-0").fill("80");
  await expect(dialog.getByTestId("v2-item-recommended-0")).toHaveText("$112.00");
  await expect(dialog.getByTestId("v2-item-final-0")).toHaveValue("55");
  await dialog.getByTestId("v2-item-unit-cost-0").fill("40");
  await save(dialog);

  const stored = (await state(page)).billingItems.find((item) => item.projectId === projectId)!;
  expect(stored.amount).toBe(55);
  expect(stored.unitPrice).toBe(55);

  const again = await edit(page, "V3 Markup");
  await expect(again.getByTestId("v2-item-final-0")).toHaveValue("55");
  await expect(again.getByTestId("v2-item-recommended-0")).toHaveText("$60.00");
  await expect(again.getByTestId("v3-item-final-mode-0")).toHaveAttribute("data-mode", "manual");
  await again.getByTestId("v2-item-reset-0").click();
  await expect(again.getByTestId("v2-item-final-0")).toHaveValue("60.00");
});

test("REGRESSION: a manual Final Unit Price survives Qty 180 → 181 and 180 → 200", async ({ page }) => {
  await signIn(page);
  const projectId = await newProject(page, "V3 Qty");
  await addItem(page, projectId, { description: "Posters", type: "PRINT", serviceType: "PRINTING", quantity: 180, printCost: 360 });

  const dialog = await edit(page, "V3 Qty");
  await dialog.getByTestId("v3-item-final-unit-0").fill("4.30");
  await expect(dialog.getByTestId("v2-item-final-0")).toHaveValue("774.00");

  await dialog.getByTestId("v2-item-quantity-0").fill("181");
  await expect(dialog.getByTestId("v3-item-final-unit-0")).toHaveValue("4.30");
  await expect(dialog.getByTestId("v2-item-final-0")).toHaveValue("778.30");

  await dialog.getByTestId("v2-item-quantity-0").fill("200");
  await expect(dialog.getByTestId("v3-item-final-unit-0")).toHaveValue("4.30");
  await expect(dialog.getByTestId("v2-item-final-0")).toHaveValue("860.00");
  if (SHOTS) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await dialog.screenshot({ path: `${SHOTS}/v3-edit-desktop.png` });
  }
  await save(dialog);

  let stored = (await state(page)).billingItems.find((item) => item.projectId === projectId)!;
  expect(stored).toMatchObject({ quantity: 200, unitPrice: 4.3, amount: 860 });

  // After a reload the stored unit price is the one that stays fixed.
  await page.reload();
  const again = await edit(page, "V3 Qty");
  await expect(again.getByTestId("v3-item-final-unit-0")).toHaveValue("4.3");
  await again.getByTestId("v2-item-quantity-0").fill("180");
  await expect(again.getByTestId("v2-item-final-0")).toHaveValue("774.00");
  await again.getByTestId("v2-item-quantity-0").fill("181");
  await expect(again.getByTestId("v3-item-final-unit-0")).toHaveValue("4.3");
  await expect(again.getByTestId("v2-item-final-0")).toHaveValue("778.30");
  await save(again);
  stored = (await state(page)).billingItems.find((item) => item.projectId === projectId)!;
  expect(stored).toMatchObject({ quantity: 181, unitPrice: 4.3, amount: 778.3 });
});

test("an expression in Final Total stores the number, not the formula", async ({ page }) => {
  await signIn(page);
  const projectId = await newProject(page, "V3 Expression");
  await addItem(page, projectId, { description: "Cards", type: "PRINT", serviceType: "PRINTING", quantity: 150, printCost: 300 });

  const dialog = await edit(page, "V3 Expression");
  await dialog.getByTestId("v2-item-final-0").fill("4.3*150");
  await expect(dialog.getByTestId("v3-item-final-unit-0")).toHaveValue("4.30");
  await dialog.getByTestId("v2-item-final-0").press("Tab");
  await expect(dialog.getByTestId("v2-item-final-0")).toHaveValue("645.00");
  await save(dialog);
  const stored = (await state(page)).billingItems.find((item) => item.projectId === projectId)!;
  expect(stored.amount).toBe(645);
});

test("deposit: none, partial, paid in full, overpaid — persisted across reloads", async ({ page }) => {
  await signIn(page);
  const projectId = await newProject(page, "V3 Deposit");
  await addItem(page, projectId, { description: "Brand book", type: "DESIGN", serviceType: "DESIGN", amount: 650 });

  const deposit = async () => (await state(page)).projects.find((project) => project.id === projectId)!.depositAmount ?? null;
  expect(await deposit()).toBeNull();

  let dialog = await edit(page, "V3 Deposit");
  await expect(dialog.getByTestId("v3-edit-balance-remaining")).toHaveText("$650.00");
  await dialog.getByTestId("v3-deposit-input").fill("200");
  await expect(dialog.getByTestId("v3-edit-balance-remaining")).toHaveText("$450.00");
  if (SHOTS) {
    await page.setViewportSize({ width: 390, height: 844 });
    await dialog.screenshot({ path: `${SHOTS}/v3-edit-mobile.png` });
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  await save(dialog);
  expect(await deposit()).toBe(200);
  await expect(dialog.getByTestId("v3-balance-deposit")).toHaveText("$200.00");
  await expect(dialog.getByTestId("v3-balance-remaining")).toHaveText("$450.00");
  if (SHOTS) await dialog.screenshot({ path: `${SHOTS}/v3-view-desktop.png` });

  await page.reload();
  await expect(page.getByTestId("v2-project-row").filter({ hasText: "V3 Deposit" }).getByTestId("v3-project-balance")).toHaveText(
    "Deposit $200.00 · Remaining $450.00",
  );
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/v3-board-desktop.png`, fullPage: true });

  dialog = await edit(page, "V3 Deposit");
  await dialog.getByTestId("v3-deposit-input").fill("650");
  await expect(dialog.getByTestId("v3-edit-balance-remaining")).toHaveText("$0.00");
  await expect(dialog.getByTestId("v3-edit-balance-paid")).toBeVisible();
  await dialog.getByTestId("v3-deposit-input").fill("700");
  await expect(dialog.getByTestId("v3-edit-balance-remaining")).toHaveText("$0.00");
  await expect(dialog.getByTestId("v3-edit-balance-overpaid")).toHaveText("Overpaid $50.00");
  // Deposit is payment information only: the price does not move.
  await expect(dialog.getByTestId("v2-item-final-0")).toHaveValue("650");
  await save(dialog);
  expect(await deposit()).toBe(700);
  await page.reload();
  await expect(page.getByTestId("v2-project-row").filter({ hasText: "V3 Deposit" }).getByTestId("v3-project-balance")).toContainText(
    "Overpaid $50.00",
  );

  dialog = await edit(page, "V3 Deposit");
  await dialog.getByTestId("v3-deposit-input").fill("");
  await expect(dialog.getByTestId("v3-edit-balance-remaining")).toHaveText("$650.00");
  await save(dialog);
  expect(await deposit()).toBeNull();
  const item = (await state(page)).billingItems.find((entry) => entry.projectId === projectId)!;
  expect(item.amount).toBe(650);
});

test("billed work stays locked: no price, unit price or deposit change", async ({ page }) => {
  await signIn(page);
  const projectId = await newProject(page, "V3 Locked");
  const itemId = await addItem(page, projectId, { description: "Logo", type: "DESIGN", serviceType: "DESIGN", amount: 300 });
  expect((await page.request.post(`/api/billing-items/${itemId}/complete`)).ok()).toBeTruthy();
  expect((await page.request.patch(`/api/projects/${projectId}/readiness`, { data: { readiness: "READY" } })).ok()).toBeTruthy();
  const billed = await page.request.post("/api/billing-v2/billed", { data: { projectIds: [projectId] } });
  expect(billed.ok()).toBeTruthy();

  const before = (await state(page)).billingItems.find((entry) => entry.id === itemId)!;
  const price = await page.request.patch(`/api/billing-items/${itemId}/billing-price`, { data: { amount: 400, unitPrice: 400 } });
  expect(price.status()).toBe(409);
  expect((await price.json()).code).toBe("ITEM_LOCKED");
  const deposit = await page.request.patch(`/api/projects/${projectId}/deposit`, { data: { amount: 100 } });
  expect(deposit.status()).toBe(409);
  expect((await deposit.json()).code).toBe("PROJECT_LOCKED");
  const after = (await state(page)).billingItems.find((entry) => entry.id === itemId)!;
  expect(after).toEqual(before);

  await page.goto("/office-v3");
  await expect(page.getByRole("button", { name: "Open V3 Locked" })).toHaveCount(0);
});

test("a manual markup persists: 35% · Manual survives save and reload, and prices a later cost", async ({ page }) => {
  await signIn(page);
  const projectId = await newProject(page, "V3 Saved Markup");
  await addItem(page, projectId, { description: "Leaflets", type: "PRINT", serviceType: "PRINTING", quantity: 1, printCost: 40 });
  // An untouched neighbour: its NULL markup and its price must not move.
  const otherId = await newProject(page, "V3 Untouched");
  await addItem(page, otherId, { description: "Cards", type: "PRINT", serviceType: "PRINTING", quantity: 1, printCost: 40 });
  const untouched = () => state(page).then((snap) => snap.billingItems.find((item) => item.projectId === otherId)!);
  const untouchedBefore = await untouched();
  const line = () => state(page).then((snap) => snap.billingItems.find((item) => item.projectId === projectId)!);

  // 1. default 50% → manual 35%
  let dialog = await edit(page, "V3 Saved Markup");
  await expect(dialog.getByTestId("v3-item-markup-0")).toHaveValue("50");
  await dialog.getByTestId("v3-item-markup-0").fill("35");
  await expect(dialog.getByTestId("v2-item-recommended-0")).toHaveText("$54.00");
  // 2. save
  await save(dialog);
  expect(await line()).toMatchObject({ markupOverride: 35, amount: 54 });

  // 3. reload → 4. markup still 35% · Manual
  await page.reload();
  dialog = await edit(page, "V3 Saved Markup");
  await expect(dialog.getByTestId("v3-item-markup-0")).toHaveValue("35");
  await expect(dialog.getByTestId("v3-item-markup-manual-0")).toHaveText("Manual");
  await expect(dialog.getByTestId("v2-item-recommended-0")).toHaveText("$54.00");
  if (SHOTS) await dialog.getByTestId("v2-item").screenshot({ path: `${SHOTS}/v3-markup-manual.png` });

  // 5. change Cost → 6. Recommended uses 35%, not the 40% band
  await dialog.getByTestId("v2-item-unit-cost-0").fill("80");
  await expect(dialog.getByTestId("v2-item-recommended-0")).toHaveText("$108.00");
  await expect(dialog.getByTestId("v3-item-markup-0")).toHaveValue("35");
  await save(dialog);
  expect(await line()).toMatchObject({ markupOverride: 35, amount: 108 });
  await page.reload();
  dialog = await edit(page, "V3 Saved Markup");
  await expect(dialog.getByTestId("v3-item-markup-0")).toHaveValue("35");
  await expect(dialog.getByTestId("v2-item-recommended-0")).toHaveText("$108.00");

  // 7. Use default → 8. back to the automatic tier ($80 → 40%)
  await dialog.getByTestId("v3-item-markup-reset-0").click();
  await expect(dialog.getByTestId("v3-item-markup-0")).toHaveValue("40");
  await expect(dialog.getByTestId("v3-item-markup-default-0")).toBeVisible();
  await expect(dialog.getByTestId("v2-item-recommended-0")).toHaveText("$112.00");
  await save(dialog);
  expect((await line()).markupOverride ?? null).toBeNull();
  await page.reload();
  dialog = await edit(page, "V3 Saved Markup");
  await expect(dialog.getByTestId("v3-item-markup-0")).toHaveValue("40");
  await expect(dialog.getByTestId("v3-item-markup-default-0")).toBeVisible();

  // 9. the NULL-markup row was never touched
  expect(await untouched()).toEqual(untouchedBefore);
  expect(untouchedBefore.markupOverride ?? null).toBeNull();
});

test("a billed line's markup stays locked", async ({ page }) => {
  await signIn(page);
  const projectId = await newProject(page, "V3 Locked Markup");
  const itemId = await addItem(page, projectId, { description: "Logo", type: "DESIGN", serviceType: "DESIGN", amount: 300 });
  expect((await page.request.post(`/api/billing-items/${itemId}/complete`)).ok()).toBeTruthy();
  expect((await page.request.patch(`/api/projects/${projectId}/readiness`, { data: { readiness: "READY" } })).ok()).toBeTruthy();
  expect((await page.request.post("/api/billing-v2/billed", { data: { projectIds: [projectId] } })).ok()).toBeTruthy();
  const response = await page.request.patch(`/api/billing-items/${itemId}/markup`, { data: { markupPercent: 35 } });
  expect(response.status()).toBe(409);
  expect((await response.json()).code).toBe("ITEM_LOCKED");
});

test("HOTFIX: a manual Final ($305.00 at 170 × $1.79) never moves on a Markup or Cost change", async ({ page }) => {
  await signIn(page);
  const projectId = await newProject(page, "V3 Manual 305");
  const itemId = await addItem(page, projectId, {
    description: "Labels",
    type: "PRINT",
    serviceType: "PRINTING",
    quantity: 170,
    printCost: 212.5,
  });
  // The historical manual price, as stored today: total only.
  expect((await page.request.patch(`/api/billing-items/${itemId}/billing-price`, { data: { amount: 305 } })).ok()).toBeTruthy();
  const stored = async () => (await state(page)).billingItems.find((item) => item.id === itemId)!;

  let dialog = await edit(page, "V3 Manual 305");
  await expect(dialog.getByTestId("v2-item-recommended-0")).toHaveText("$276.25");
  await expect(dialog.getByTestId("v2-item-final-0")).toHaveValue("305");
  await expect(dialog.getByTestId("v3-item-final-unit-0")).toHaveValue("1.79");
  await expect(dialog.getByTestId("v3-item-final-mode-0")).toHaveAttribute("data-mode", "manual");

  // Markup 30% → 40%: Recommended only.
  await dialog.getByTestId("v3-item-markup-0").fill("40");
  await expect(dialog.getByTestId("v2-item-recommended-0")).toHaveText("$297.50");
  await expect(dialog.getByTestId("v2-item-final-0")).toHaveValue("305");
  await expect(dialog.getByTestId("v3-item-final-unit-0")).toHaveValue("1.79");
  await save(dialog);
  expect(await stored()).toMatchObject({ amount: 305, markupOverride: 40, quantity: 170 });

  // Reload; Use default; Cost 1.25 → 1.50: Recommended only.
  await page.reload();
  dialog = await edit(page, "V3 Manual 305");
  await expect(dialog.getByTestId("v2-item-final-0")).toHaveValue("305");
  await dialog.getByTestId("v3-item-markup-reset-0").click();
  await expect(dialog.getByTestId("v2-item-recommended-0")).toHaveText("$276.25");
  await expect(dialog.getByTestId("v2-item-final-0")).toHaveValue("305");
  await dialog.getByTestId("v2-item-unit-cost-0").fill("1.50");
  await expect(dialog.getByTestId("v3-item-total-cost-0")).toHaveText("$255.00");
  await expect(dialog.getByTestId("v2-item-recommended-0")).toHaveText("$331.50");
  await expect(dialog.getByTestId("v2-item-final-0")).toHaveValue("305");
  await expect(dialog.getByTestId("v3-item-final-unit-0")).toHaveValue("1.79");
  await save(dialog);
  expect(await stored()).toMatchObject({ amount: 305, markupOverride: null, quantity: 170 });

  // Qty 170 → 171: the unit rule (intended) — $1.79 × 171 = $306.09.
  dialog = await edit(page, "V3 Manual 305");
  await dialog.getByTestId("v2-item-quantity-0").fill("171");
  await expect(dialog.getByTestId("v3-item-final-unit-0")).toHaveValue("1.79");
  await expect(dialog.getByTestId("v2-item-final-0")).toHaveValue("306.09");

  // Use recommended: only now does Final follow Recommended ($1.50 × 171 = $256.50, +30% → $333.45).
  await expect(dialog.getByTestId("v2-item-recommended-0")).toHaveText("$333.45");
  await dialog.getByTestId("v2-item-reset-0").click();
  await expect(dialog.getByTestId("v3-item-final-mode-0")).toHaveAttribute("data-mode", "auto");
  await expect(dialog.getByTestId("v2-item-final-0")).toHaveValue("333.45");
  await dialog.getByTestId("v2-modal-cancel").click();
  expect(await stored()).toMatchObject({ amount: 305, quantity: 170 });
});
