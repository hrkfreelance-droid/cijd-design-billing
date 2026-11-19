import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { missingHistory } from "../../scripts/v5-import/legacy-history";
import type { Snapshot, TaxInvoiceRecord } from "../../src/lib/types";
import { planV3Import } from "../../src/lib/billing-v5/v3-import";
import { archiveId, archiveItem, archiveName, workspaceFixture } from "../fixtures/v5-workspace-history";

const fixtureProjects = missingHistory(planV3Import(workspaceFixture()), new Set(), new Set()).rows;

const exampleInvoice: TaxInvoiceRecord = {
  id: "example-layout-invoice", invoiceNumber: "EXAMPLE-LAYOUT-000000001", invoiceDate: "2026-09-01",
  issuedAt: "2026-09-01T00:00:00Z", issuedBy: "Example accountant", status: "ISSUED",
  clientId: "c1", projectId: archiveId, ledgerInvoiceId: "",
  customer: { companyNameEn: "Example Studio", companyNameKm: "", addressEn: "", addressKm: "", telephone: "", vatin: "" },
  project: { name: archiveName, note: "" },
  lines: [{ billingItemId: "l-billed", description: archiveItem, quantity: 123456789, unit: "pcs", unitPrice: 1, amount: 123456789 }],
  vatApplicable: false, vatPercent: 0, subtotalUsd: 123456789, vatUsd: 0, totalUsd: 123456789,
  exchangeRate: 4100, exchangeRateSource: "MANUAL", exchangeRateEffectiveDate: null, totalKhr: 506172834900,
};

async function addHistory(page: Page, includeLayoutInvoice = false) {
  if (process.env.V5_EXPECT_HISTORY === "1") {
    const response = await page.request.get("/api/state");
    expect(response.ok()).toBe(true);
    expect(((await response.json()).data.legacyProjects as { project: { id: string } }[]).map(({ project }) => project.id)).toContain(archiveId);
    if (!includeLayoutInvoice) return;
  }
  await page.route("**/api/state", async (route) => {
    const response = await route.fetch();
    const payload = await response.json() as { data: Snapshot };
    if (process.env.V5_EXPECT_HISTORY !== "1") payload.data.legacyProjects = fixtureProjects;
    if (includeLayoutInvoice) payload.data.taxInvoices = [...(payload.data.taxInvoices ?? []), exampleInvoice];
    await route.fulfill({ response, json: payload });
  });
}

test("design archive, global search, project details and price comparison share the same historical records", async ({ page }) => {
  await addHistory(page);
  await page.goto("/office-v5");
  await page.getByRole("link", { name: "Design", exact: true }).click();
  await expect(page).toHaveURL(/kind=design/);
  await page.getByRole("link", { name: "Archive", exact: true }).click();
  await expect(page).toHaveURL(/status=completed/);
  const search = page.getByTestId("billing-project-search");
  await search.fill("ＡＲＣＨＩＶＥ    Brochure");
  await expect(page.getByTestId("billing-project-row")).toHaveCount(1);
  await page.getByTestId("billing-project-row").filter({ hasText: archiveName }).click();
  await expect(page).toHaveURL(new RegExp("/office-v5/projects/" + archiveId));
  const detail = page.getByTestId("billing-project-detail");
  await expect(detail.getByRole("heading", { name: archiveName })).toBeVisible();
  await expect(detail.getByText("EXAMPLE-ARCHIVE-01")).toBeVisible();
  await expect(detail.getByText("$120,000,000.00")).toBeVisible();
  await expect(detail.getByText("2026-09-02", { exact: true })).toBeVisible();
  await expect(detail.getByText("Archive Brochure earlier edition")).toBeVisible();
  await expect(detail.getByTestId("v2-modal-edit")).toHaveCount(0);
  await detail.getByTestId("billing-detail-line").filter({ hasText: archiveItem }).getByRole("link", { name: "Price history" }).click();
  await expect(page.getByTestId("billing-price-history").getByText("Latest unit price")).toBeVisible();
  await expect(page.locator(".bw-price-rows > li")).toHaveCount(2);
  await expect(page.getByText("$1.50", { exact: true }).first()).toBeVisible();

  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  const dialog = page.getByRole("dialog", { name: "Search Billing" });
  await dialog.getByRole("searchbox").fill("EXAMPLE-ARCHIVE-01");
  await dialog.getByRole("link", { name: new RegExp(archiveName) }).click();
  await expect(page.getByTestId("billing-project-detail")).toBeVisible();
  await detail.getByRole("link", { name: "Example Studio" }).click();
  const customer = page.getByTestId("billing-customer-detail");
  await expect(customer.getByRole("heading", { name: "Example Studio" })).toBeVisible();
  await expect(customer.getByRole("heading", { name: "Payments" })).toBeVisible();
  await expect(customer.getByRole("heading", { name: "Price history" })).toBeVisible();
  await page.goto("/office-v5/archive");
  await expect(page).toHaveURL(/\/office-v5\/projects\?status=completed/);
  await page.getByLabel("Sort by").selectOption("highest");
  const rows = page.getByTestId("billing-project-row");
  await expect(rows.first()).toContainText(archiveName);
  await page.locator(".bw-filter-extra summary").click();
  await page.getByLabel("Max. amount (USD)", { exact: true }).fill("500");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Archive Brochure earlier edition");
  await page.getByLabel("Work type").selectOption("design");
  await expect(page.getByText("No projects found")).toBeVisible();
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(rows).toHaveCount(2);
});

async function layoutIssues(page: Page) {
  return page.evaluate(() => {
    const issues: string[] = [];
    const tolerance = 1;
    const describe = (el: Element) => el.getAttribute("data-testid") ?? `${el.tagName}.${el.classList[0] ?? ""}`;
    if (document.documentElement.scrollWidth > innerWidth + tolerance) issues.push("viewport horizontal overflow");
    const visible = (el: Element) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
    const collide = (a: DOMRect, b: DOMRect) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > tolerance
      && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > tolerance;
    for (const el of document.querySelectorAll("[data-layout-group]")) {
      if (!visible(el)) continue;
      const box = el.getBoundingClientRect();
      const children = Array.from(el.children).filter((child) => visible(child) && child.tagName !== "DIALOG"
        && !child.classList.contains("sr-only"));
      for (const [index, child] of children.entries()) {
        const rect = child.getBoundingClientRect();
        if (rect.left < box.left - tolerance || rect.right > box.right + tolerance ||
          rect.top < box.top - tolerance || rect.bottom > box.bottom + tolerance) {
          issues.push(`${describe(child)} outside ${describe(el)}`);
        }
        for (const sibling of children.slice(index + 1)) {
          if (collide(rect, sibling.getBoundingClientRect())) issues.push(`${describe(child)} overlaps ${describe(sibling)}`);
        }
      }
    }
    for (const el of document.querySelectorAll<HTMLElement>(".bw-main :is(a, button, strong, small, dd, h1, h2, label), .bw-header button")) {
      if (!visible(el) || el.closest(".truncate, .sr-only") || getComputedStyle(el).display === "inline") continue;
      if (el.scrollWidth > el.clientWidth + tolerance && el.clientWidth > 0) issues.push(`${describe(el)} text or control overflow`);
    }
    for (const value of document.querySelectorAll(".bw-line-numbers dd")) {
      if (!value.textContent?.startsWith("$") || !visible(value)) continue;
      const range = document.createRange();
      range.selectNodeContents(value);
      if (range.getClientRects().length > 1) issues.push("money wraps inside a line item");
    }
    return [...new Set(issues)];
  });
}

test("Billing layout has no overlaps at 1440 and 375 in JA, EN and KH, light and dark", async ({ page }) => {
  test.setTimeout(240_000);
  await addHistory(page, true);
  await page.goto("/office-v5");
  const routes = [
    ["/office-v5", "billing-home", "home"],
    ["/office-v5/projects?status=completed", "billing-projects", "projects"],
    [`/office-v5/projects/${archiveId}?status=completed`, "billing-project-detail", "detail"],
    [`/office-v5/price-history?${new URLSearchParams({ q: archiveItem })}`, "billing-price-history", "prices"],
    ["/office-v5/tax-invoices", "billing-invoices", "invoices"],
    ["/office-v5/accounting", "v5-accounting", "accounting"],
    ["/office-v5/customers", "v5-customers-page", "customers"],
    ["/office-v5/customers/c1", "billing-customer-detail", "customer"],
  ];
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 870 });
    for (const locale of ["en", "ja", "kh"]) {
      for (const theme of ["light", "dark"]) {
        await page.evaluate(([language, mode]) => {
          localStorage.setItem("cijd.locale", language);
          localStorage.setItem("cijd.theme", mode);
        }, [locale, theme] as const);
        for (const [path, testId, name] of routes) {
          await page.goto(path);
          await expect(page.getByTestId(testId)).toBeVisible();
          await expect(page.locator("html")).toHaveAttribute("lang", locale === "kh" ? "km" : locale);
          if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
          else await expect(page.locator("html")).not.toHaveClass(/dark/);
          if (name === "projects") await page.locator(".bw-filter-extra summary").click();
          await page.evaluate(() => document.fonts.ready);
          expect(await layoutIssues(page), `${name} / ${width} / ${locale} / ${theme}`).toEqual([]);
          const dir = process.env.V5_WORKSPACE_SHOTS;
          if (dir && ((locale === "en" && theme === "light" && width === 1440 && ["home", "detail", "prices"].includes(name))
            || (locale === "kh" && theme === "dark" && width === 375 && name === "detail")
            || (locale === "ja" && theme === "light" && width === 375 && name === "projects"))) {
            mkdirSync(dir, { recursive: true });
            await page.screenshot({ path: join(dir, `${name}-${width}-${locale}-${theme}.jpg`), type: "jpeg", quality: 83, fullPage: name === "detail" });
          }
        }
      }
    }
  }
});

test("the header follows system appearance until an explicit preference is saved", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/office-v5");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "Switch appearance" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.getByRole("combobox", { name: "Language" }).selectOption("ja");
  await expect(page.getByRole("heading", { name: "ホーム" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "ホーム" })).toBeVisible();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});

test("Billing provides loading, retry and empty results", async ({ page }) => {
  let recover = false;
  let releaseRequest: () => void = () => {};
  const initialRequest = new Promise<void>((resolve) => { releaseRequest = resolve; });
  await page.route("**/api/state", async (route) => {
    if (!recover) {
      await initialRequest;
      await route.fulfill({ status: 503, json: { ok: false, message: "Test outage" } });
    } else {
      await route.continue();
    }
  });
  await page.goto("/office-v5/projects");
  await expect(page.getByRole("status")).toHaveText("Loading");
  releaseRequest();
  await expect(page.getByRole("alert")).toContainText("Could not load data");
  recover = true;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("billing-projects")).toBeVisible();
  await page.getByTestId("billing-project-search").fill("example-no-matches-987");
  await expect(page.getByText("No projects found")).toBeVisible();
});
