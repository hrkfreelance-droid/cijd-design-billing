import { expect, test } from "@playwright/test";

test("preview billing roles can only observe the progress workspace", async ({ page }) => {
  test.skip(process.env.NEXT_PUBLIC_DEMO_MODE !== "1", "Preview demo mode only");

  await page.addInitScript(() => {
    localStorage.setItem("cijd.demo.user", "u_billing");
    localStorage.setItem("cijd.locale", "en");
    localStorage.setItem("cijd.theme", "light");
  });
  await page.goto("/office/progress");

  const readonly = page.getByTestId("progress-readonly");
  await expect(page.getByRole("heading", { name: "Progress", level: 1 })).toBeVisible();
  await expect(readonly).toContainText("RH Spicy Egg Voucher");
  await expect(readonly).toContainText("Price Check");
  await expect(readonly).toContainText("Revision");
  await expect(readonly).toContainText("iStand");
  await expect(readonly).not.toContainText("Correction");
  await expect(readonly.getByRole("button")).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("progress-readonly")).toContainText("RH Spicy Egg Voucher");
  await expect(page.getByTestId("progress-readonly").getByRole("button")).toHaveCount(0);
});

test("preview RH Kids completed work stays in the Designer ready tab", async ({ page }) => {
  test.skip(process.env.NEXT_PUBLIC_DEMO_MODE !== "1", "Preview demo mode only");

  await page.addInitScript(() => {
    localStorage.setItem("cijd.demo.user", "u_hiroki");
    localStorage.setItem("cijd.locale", "en");
    localStorage.setItem("cijd.theme", "light");
  });
  await page.goto("/designer/projects/pj_rh_kids_promotion");

  const revision = page.getByTestId("designer-project-item").filter({ hasText: "Revision" }).first();
  await revision.getByRole("button", { name: "Complete" }).click();
  await page.getByRole("dialog").last().getByRole("button", { name: "Mark as complete" }).click();
  await expect(page.getByText("Marked as complete")).toBeVisible();

  await page.goto("/designer/delivered");
  const readyProject = page.getByRole("link", { name: /RH Kids Promotion/ });
  await expect(readyProject).toBeVisible();
  await readyProject.click();
  await expect(page.getByText("Revision")).toBeVisible();
  await expect(page.getByText("iStand")).toBeVisible();

  const item = page.getByTestId("designer-project-item").filter({ hasText: "Revision" }).first();
  await item.getByRole("button", { name: "Revision", exact: true }).click();
  const editor = page.getByRole("dialog").last();
  await editor.getByLabel("Amount").fill("20");
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Item updated")).toBeVisible();
  await item.getByRole("button", { name: "Undo completion" }).click();
  await page.getByRole("dialog").last().getByRole("button", { name: "Undo completion" }).click();
  await expect(page.getByText("Completion undone")).toBeVisible();
});

test("preview restores the 71-row Ringer Hut history without resetting browser state", async ({ page }) => {
  test.skip(process.env.NEXT_PUBLIC_DEMO_MODE !== "1", "Preview demo mode only");

  await page.addInitScript(() => {
    localStorage.setItem("cijd.demo.user", "u_hiroki");
    localStorage.setItem("cijd.locale", "en");
    localStorage.setItem("cijd.theme", "light");
  });
  await page.goto("/designer/archive");

  await expect(page.getByRole("heading", { name: "Archive", level: 1 })).toBeVisible();
  const monthFilter = page.getByRole("combobox", { name: "All months" });
  await expect(monthFilter.locator("option")).toHaveCount(8);
  const monthValues = await monthFilter.locator("option").evaluateAll((options) =>
    options.map((option) => (option as HTMLOptionElement).value),
  );
  expect(monthValues).toEqual(
    expect.arrayContaining([
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
    ]),
  );

  const summary = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem("cijd.demo.db") ?? "{}");
    const projects = new Map(
      db.projects.map((project: { id: string; clientId: string }) => [project.id, project.clientId]),
    );
    const history = db.billingItems.filter((item: { createdBy: string }) => item.createdBy === "Import");
    return {
      historyCount: history.length,
      historyClients: [...new Set(history.map((item: { projectId: string }) => projects.get(item.projectId)))],
      months: [...new Set(history.map((item: { historicalMonth: string }) => item.historicalMonth))],
      statuses: history.reduce((counts: Record<string, number>, item: { billingStatus: string }) => {
        counts[item.billingStatus] = (counts[item.billingStatus] ?? 0) + 1;
        return counts;
      }, {}),
    };
  });
  expect(summary.historyCount).toBe(71);
  expect(summary.historyClients).toEqual(["cl_ringer_hut"]);
  expect(summary.months).toHaveLength(7);
  expect(summary.statuses).toEqual({ NEEDS_REVIEW: 42, INVOICED: 29 });

  const designerArchiveMonths = await page.locator("a[data-historical-latest-month]").evaluateAll((links) =>
    links.map((link) => link.getAttribute("data-historical-latest-month")),
  );
  expect(designerArchiveMonths).toEqual([...designerArchiveMonths].sort().reverse());

  await monthFilter.selectOption("2026-02");
  await expect(page.getByRole("link", { name: /Ringer Hut Storefront Sign/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Ringer Hut A4/ })).toBeVisible();
  await page.getByRole("button", { name: "Ringer Hut", exact: true }).click();
  await expect(page.getByRole("link", { name: /Ringer Hut Storefront Sign/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Ringer Hut A4/ })).toBeVisible();

  // Re-opening the store runs the migration again, but keeps the same 71 rows.
  await page.reload();
  const afterReload = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem("cijd.demo.db") ?? "{}");
    return db.billingItems.filter((item: { createdBy: string }) => item.createdBy === "Import").length;
  });
  expect(afterReload).toBe(71);
});
