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
