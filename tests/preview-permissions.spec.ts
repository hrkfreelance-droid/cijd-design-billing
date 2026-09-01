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
