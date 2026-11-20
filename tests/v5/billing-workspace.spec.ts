import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { missingHistory } from "../../scripts/v5-import/legacy-history";
import type { Snapshot, TaxInvoiceRecord } from "../../src/lib/types";
import { planV3Import } from "../../src/lib/billing-v5/v3-import";
import { archiveId, archiveItem, archiveName, workspaceFixture } from "../fixtures/v5-workspace-history";

const importNote = "Current active project added 2026-08-31";
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

async function addHistory(page: Page, includeLayoutInvoice = false, edit?: (snapshot: Snapshot) => void) {
  if (process.env.V5_EXPECT_HISTORY === "1") {
    const response = await page.request.get("/api/state");
    expect(response.ok()).toBe(true);
    expect(((await response.json()).data.legacyProjects as { project: { id: string } }[]).map(({ project }) => project.id)).toContain(archiveId);
    if (!includeLayoutInvoice && !edit) return;
  }
  await page.route("**/api/state", async (route) => {
    const response = await route.fetch();
    const payload = await response.json() as { data: Snapshot };
    if (process.env.V5_EXPECT_HISTORY !== "1") payload.data.legacyProjects = fixtureProjects;
    if (includeLayoutInvoice) {
      payload.data.legacyProjects = payload.data.legacyProjects?.map((entry) => entry.project.id === archiveId
        ? { ...entry, project: { ...entry.project, note: importNote } }
        : entry);
      payload.data.taxInvoices = [...(payload.data.taxInvoices ?? []), exampleInvoice];
    }
    edit?.(payload.data);
    await route.fulfill({ response, json: payload });
  });
}

test("design archive, global search, project details and price comparison share the same historical records", async ({ page }) => {
  await addHistory(page);
  await page.goto("/office-v5");
  await page.getByRole("link", { name: "Archive", exact: true }).click();
  await expect(page).toHaveURL(/\/office-v5\/archive$/);
  const search = page.getByTestId("billing-project-search");
  await search.fill("ＡＲＣＨＩＶＥ    Brochure artwork");
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
  const archive = await page.request.get("/office-v5/archive", { maxRedirects: 0 });
  expect(archive.status()).toBe(200);
  await page.goto("/office-v5/archive");
  await expect(page.getByRole("link", { name: "Price history", exact: true })).toHaveAttribute("href", "/office-v5/price-history");
  for (const [query, count] of [[archiveItem, 2], ["Example Studio", 2], ["EXAMPLE-ARCHIVE-01", 1]] as const) {
    await search.fill(query);
    await expect(page.getByTestId("billing-project-row")).toHaveCount(count);
  }
  await search.fill("");
  await page.getByLabel("Sort by").selectOption("highest");
  const rows = page.getByTestId("billing-project-row");
  await expect(rows.first()).toContainText(archiveName);
  await page.locator(".bw-filter-toggle").click();
  await page.getByLabel("Max. amount (USD)", { exact: true }).fill("500");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Archive Brochure earlier edition");
  await page.getByLabel("Work type").selectOption("design");
  await expect(page.getByText("No projects found")).toBeVisible();
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(rows).toHaveCount(2);
});

test("the balance-due filter also includes completed projects", async ({ page }) => {
  await addHistory(page, true);
  await page.goto("/office-v5/archive");
  const row = page.getByTestId("billing-project-row").filter({ hasText: archiveName });
  await expect(row.locator(".bw-project-badges .bw-badge")).toHaveText(["Work complete", "Partially paid"]);
  await page.getByRole("link", { name: "Balance due", exact: true }).click();
  await expect(page).toHaveURL(/status=unpaid/);
  await expect(row.locator(".bw-project-badges .bw-badge")).toHaveText(["Work complete", "Partially paid"]);
  await expect(page.getByTestId("billing-project-row").filter({ hasText: "Archive Brochure earlier edition" })).toHaveCount(0);
});

test("drafts, USD list amounts and customer pricing aliases remain separate from billing records", async ({ page }) => {
  const owner = fixtureProjects.find(({ project }) => project.id === archiveId)!;
  const alias = fixtureProjects.find(({ project }) => project.id === "p-older-billed")!;
  const liveItem = planV3Import(workspaceFixture()).collections.billingItems.find((item) => item.projectId === "p-progress")!;
  const first = { id: "price-alias-a", name: "Ringer Hut", active: true, createdAt: owner.project.createdAt };
  const second = { ...first, id: "price-alias-b", name: "Ringerhut(Cambodia) CO.,Ltd" };
  await addHistory(page, false, (snapshot) => {
    const base = { ...owner.project, clientId: first.id };
    const current = { ...base, id: "amount-preview", name: "Active estimate" };
    const draft = { ...base, id: "empty-draft", name: "Unfinished sample" };
    snapshot.clients = [...snapshot.clients, first, second];
    snapshot.projects = [...snapshot.projects, current, draft];
    snapshot.billingItems = [...snapshot.billingItems, { ...liveItem, id: "amount-line",
      projectId: current.id, invoiceId: null, amount: 20, quantity: 20 }];
    snapshot.exchangeRate = { id: "layout-rate", currencyPair: "USD/KHR", rate: 4000,
      source: "NBC", effectiveDate: "2026-09-29", fetchedAt: "2026-09-29T00:00:00Z" };
    snapshot.legacyProjects = [
      { ...owner, client: first, project: base },
      { ...alias, client: second, project: { ...alias.project, clientId: second.id, name: "A previous contract" } },
      { ...alias, client: second, project: { ...alias.project, id: "zero-reference", clientId: second.id, name: "Zero value reference" },
        items: alias.items.map((item) => ({ ...item, id: `zero-${item.id}`, projectId: "zero-reference", amount: 0 })) },
    ];
  });

  await page.goto("/office-v5/projects");
  const list = page.getByTestId("billing-projects");
  const heading = list.locator(".bw-heading");
  await expect(heading.getByRole("link", { name: "Invoices", exact: true })).toHaveAttribute("href", "/office-v5/tax-invoices");
  const rows = list.getByTestId("billing-project-row");
  await expect(rows.filter({ hasText: "Unfinished sample" })).toHaveCount(0);
  const amount = rows.filter({ hasText: "Active estimate" }).locator(".bw-project-amount");
  await expect(amount).toHaveText("$20.00");
  await expect(amount).toHaveAttribute("title", "Est. 80,000 ៛");
  await list.getByRole("link", { name: "Drafts", exact: true }).click();
  await expect(heading.getByRole("link", { name: "Invoices", exact: true })).toHaveAttribute("href", "/office-v5/tax-invoices");
  await expect(rows.filter({ hasText: "Unfinished sample" })).toBeVisible();
  await expect(rows.filter({ hasText: "Active estimate" })).toHaveCount(0);

  await page.goto(`/office-v5/projects/${owner.project.id}`);
  const detail = page.getByTestId("billing-project-detail");
  await expect(detail.getByRole("link", { name: "A previous contract" })).toBeVisible();
  await expect(detail.getByRole("link", { name: "Zero value reference" })).toHaveCount(0);
  await page.goto(`/office-v5/customers/${first.id}`);
  const customer = page.getByTestId("billing-customer-detail");
  await expect(customer.locator(".bw-project-rows").getByText("A previous contract")).toHaveCount(0);
  await expect(customer.locator(".bw-price-rows").getByText("A previous contract")).toBeVisible();
  await page.goto(`/office-v5/price-history?client=${first.id}`);
  await expect(page.locator(".bw-price-rows").getByText("A previous contract")).toBeVisible();

});

async function layoutIssues(page: Page) {
  return page.evaluate(() => {
    const issues: string[] = [];
    const tolerance = 1;
    const describe = (el: Element) => el.getAttribute("data-testid") ?? `${el.tagName}.${el.classList[0] ?? ""}`;
    if (document.documentElement.scrollWidth > innerWidth) {
      const outside = Array.from(document.querySelectorAll("main *"))
        .filter((el) => el.getBoundingClientRect().right > innerWidth && !el.closest(".sr-only"))
        .slice(0, 5).map(describe);
      issues.push(`viewport horizontal overflow (${document.documentElement.scrollWidth - innerWidth}px): ${outside.join(", ")}`);
    }
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
    for (const el of document.querySelectorAll<HTMLElement>(".bw-main :is(a, button, strong, small, dd, h1, h2, label, .bw-note, .bw-filter-help, .bw-badge, .bw-line-value), .bw-header button")) {
      if (!visible(el) || el.closest(".truncate, .sr-only") || getComputedStyle(el).display === "inline") continue;
      if (el.scrollWidth > el.clientWidth + tolerance && el.clientWidth > 0) issues.push(`${describe(el)} text or control overflow`);
    }
    for (const value of document.querySelectorAll(".bw-line-value, .bw-project-amount .bw-money > span")) {
      if (!visible(value) || !value.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(value);
      const fragments = Array.from(range.getClientRects()).filter((fragment) => fragment.width > 0);
      if (fragments.some((fragment) => Math.abs(fragment.top - fragments[0].top) > 2)) {
        issues.push(`Number wraps in ${describe(value)} (${Math.round(value.getBoundingClientRect().width)}px, ${value.textContent?.length} characters)`);
      }
      const column = value.closest("td, .bw-project-amount")?.getBoundingClientRect();
      if (column && fragments.some((fragment) => fragment.left < column.left - 2 || fragment.right > column.right + 2)) {
        issues.push(`Number exceeds its column in ${describe(value)}`);
      }
    }
    const positions = (el: Element) => {
      const bounds = el.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, center: (bounds.top + bounds.bottom) / 2 };
    };
    const textRight = (el: Element) => {
      const text = document.createRange();
      text.selectNodeContents(el);
      return text.getBoundingClientRect().right;
    };
    const aligned = (values: number[]) => values.length < 2 || Math.max(...values) - Math.min(...values) <= 2;
    for (const list of document.querySelectorAll(".bw-project-rows")) {
      const rows = Array.from(list.querySelectorAll(".bw-project-row")).filter(visible);
      for (const selector of [".bw-project-name", ".bw-project-kinds", ".bw-project-badges", ".bw-project-date"]) {
        const edges = rows.map((row) => positions(row.querySelector(selector)!));
        if (!aligned(edges.map((edge) => edge.left))) issues.push(`misaligned ${selector} columns`);
      }
      if (!aligned(rows.map((row) => textRight(row.querySelector(".bw-project-amount .bw-money > span")!)))) {
        issues.push("project amounts have different right edges");
      }
      for (const row of rows) {
        const wide = getComputedStyle(row).gridTemplateAreas.includes('"name kinds');
        const groups = wide ? [Array.from(row.children)] : [Array.from(row.children).filter((child) =>
          child.matches(".bw-project-kinds, .bw-project-badges, .bw-project-date")), Array.from(row.children).filter((child) =>
          child.matches(".bw-project-name, .bw-project-amount"))];
        for (const group of groups) {
          if (!aligned(group.filter((child) => child.getBoundingClientRect().height > 0).map((child) => positions(child).center))) {
            issues.push("project row fields have different vertical centers");
          }
        }
        for (const group of row.querySelectorAll(".bw-project-badges, .bw-project-kinds")) {
          const badges = Array.from(group.children).map(positions);
          const onSameLine = badges.length === 2 && badges[0].right <= badges[1].left;
          if (onSameLine && !aligned(badges.map(({ center }) => center))) issues.push("badges have different vertical centers");
        }
      }
    }
    for (const section of document.querySelectorAll("[data-billing-design] section")) {
      const rows = Array.from(section.querySelectorAll('[data-testid="v2-project-total"], [data-testid="v2-line-item"] > :nth-child(3)'))
        .filter((el) => visible(el) && el.textContent?.trim());
      if (!aligned(rows.map(textRight))) issues.push("Design amounts have different right edges");
      const fields = section.querySelectorAll('[data-project-heading], [data-testid="v2-line-item"]');
      for (const field of fields) {
        const primary = Array.from(field.children).filter((el) => visible(el) && !el.classList.contains("col-span-2"));
        if (!aligned(primary.map((el) => positions(el).center))) issues.push("Design row fields have different vertical centers");
        for (const element of primary) {
          const box = element.getBoundingClientRect();
          const content = document.createRange();
          content.selectNodeContents(element);
          if (Array.from(content.getClientRects()).some((fragment) => fragment.width > 0 &&
            (fragment.left < box.left - 2 || fragment.right > box.right + 2))) issues.push("Design row text exceeds its column");
        }
      }
    }
    for (const value of document.querySelectorAll('[data-billing-design] dd.tnum, [data-testid="v5-accounting"] dd.tnum')) {
      if (visible(value) && textRight(value) > value.getBoundingClientRect().right + 2) issues.push("Summary value overflows its column");
    }
    for (const table of document.querySelectorAll(".bw-lines")) {
      const rows = Array.from(table.querySelectorAll("tbody tr")).filter(visible);
      const columns = rows[0]?.querySelectorAll(".bw-line-number").length ?? 0;
      for (let i = 0; i < columns; i += 1) {
        const values = rows.map((row) => textRight(row.querySelectorAll(".bw-line-value")[i]));
        if (!aligned(values)) issues.push("line item numbers have different right edges");
      }
    }
    return [...new Set(issues)];
  });
}

test("Billing layout has no overlaps at 1440 and 375 in JA, EN and KH, light and dark", async ({ page }) => {
  test.setTimeout(240_000);
  const { collections } = planV3Import(workspaceFixture());
  const layoutClient = collections.clients[0];
  const readyProject = collections.projects.find(({ id }) => id === "p-ready")!;
  const workItem = collections.billingItems.find(({ id }) => id === "l-manual")!;
  await addHistory(page, true, (snapshot) => {
    snapshot.clients = [...snapshot.clients, { ...layoutClient, id: "layout-client", name: archiveName + archiveItem }];
    for (const [id, billingReadiness] of [["layout-ready", "READY"], ["layout-progress", "IN_PROGRESS"], ["layout-accounting", "ACCOUNTING"]] as const) {
      snapshot.projects.push({ ...readyProject, id, clientId: "layout-client", billingReadiness, name: archiveName + archiveItem });
      snapshot.billingItems.push({ ...workItem, id: id + "-line", projectId: id, description: archiveItem,
        amount: 123456789, quantity: 123456789, printCost: 120000000 });
    }
    snapshot.billingItems.push({ ...workItem, id: "layout-ready-line-2", projectId: "layout-ready", amount: 100, quantity: 100, printCost: 40 });
  });
  await page.goto("/office-v5");
  const routes = [
    ["/office-v5", "v2-section-ready", "design"],
    ["/office-v5/archive", "billing-projects", "projects"],
    [`/office-v5/projects/${archiveId}?status=completed`, "billing-project-detail", "detail"],
    [`/office-v5/price-history?${new URLSearchParams({ q: archiveItem })}`, "billing-price-history", "prices"],
    ["/office-v5/tax-invoices", "billing-invoices", "invoices"],
    ["/office-v5/accounting", "v5-accounting", "accounting"],
    ["/office-v5/customers", "v5-customers-page", "customers"],
    ["/office-v5/customers/c1", "billing-customer-detail", "customer"],
    [`/office-v5/tax-invoices/${exampleInvoice.id}`, "v5-invoice-heading", "invoice detail"],
  ];
  const translated = {
    en: ["Work complete", "Partially paid", importNote, "Print / Save PDF", "Printing"],
    ja: ["作業完了", "一部入金", "進行中の案件として 2026-08-31 に追加", "印刷 / PDF 保存", "印刷"],
    kh: ["ការងារបានបញ្ចប់", "បានទូទាត់មួយផ្នែក", "បានបន្ថែមជាគម្រោងកំពុងដំណើរការនៅថ្ងៃទី 2026-08-31", "បោះពុម្ព ឬរក្សាទុកជា PDF", "បោះពុម្ព"],
  };
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 870 });
    for (const locale of ["en", "ja", "kh"] as const) {
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
          const [work, payment, note, print, printing] = translated[locale];
          if (name === "projects" || name === "detail") {
            const row = name === "projects"
              ? page.getByTestId("billing-project-row").filter({ hasText: archiveName })
              : page.getByTestId("billing-project-detail");
            await expect(row.locator(".bw-project-badges [data-status=completed]")).toHaveText(work);
            await expect(row.locator(".bw-project-badges [data-status=partial]")).toHaveText(payment);
          }

          if (name === "detail") await expect(page.locator(".bw-note")).toHaveText(note);
          if (name === "invoice detail") await expect(page.getByTestId("v5-print")).toHaveText(print);
          await page.evaluate(() => document.fonts.ready);
          expect.soft(await layoutIssues(page), `${name} / ${width} / ${locale} / ${theme}`).toEqual([]);
          if (name === "design") {
            const ready = page.getByTestId("v2-section-ready");
            await expect(ready.getByTestId("v2-line-item").first().getByText(printing, { exact: true })).toBeVisible();
            await ready.getByRole("checkbox").first().click();
            const selection = page.getByTestId("v2-selection-actions");
            await expect(selection).toBeVisible();
            expect.soft(await layoutIssues(page), `selection / ${width} / ${locale} / ${theme}`).toEqual([]);
            await ready.getByRole("checkbox").first().click();
            await expect(selection).toBeHidden();
            const contrast = await page.evaluate(() => {
              const styles = getComputedStyle(document.body);
              const luminance = (token: string) => {
                const value = styles.getPropertyValue(token).trim().slice(1);
                const hex = value.length === 3 ? [...value].map((char) => char.repeat(2)).join("") : value;
                return [0.2126, 0.7152, 0.0722].reduce((total, weight, index) => {
                  const channel = parseInt(hex.slice(index * 2, index * 2 + 2), 16) / 255;
                  return total + weight * (channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
                }, 0);
              };
              return [
                ["--c-text", "--c-bg"], ["--bw-ink", "--c-panel"], ["--c-muted", "--c-fill"],
                ["--bw-action", "--bw-selected"], ["--c-on-accent", "--bw-brand"], ["--c-danger", "--c-panel"],
              ].map(([foreground, background]) => {
                const [dark, light] = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
                return (light + .05) / (dark + .05);
              });
            });
            for (const ratio of contrast) expect(ratio).toBeGreaterThanOrEqual(4.5);
          }
          const dir = process.env.V5_WORKSPACE_SHOTS;
          if (name === "projects") {
            await page.locator(".bw-filter-toggle").click();
            expect.soft(await layoutIssues(page), `expanded filters / ${width} / ${locale} / ${theme}`).toEqual([]);
            if (dir && theme === "light" && (width === 1440 && locale === "en" || width === 375 && locale === "ja")) {
              mkdirSync(dir, { recursive: true });
              await page.screenshot({ path: join(dir, `projects-expanded-${width}-${locale}-${theme}.jpg`), type: "jpeg", quality: 83 });
            }
            await page.locator(".bw-filter-toggle").click();
            await page.mouse.move(0, 0);
          }
          if (dir && ((locale === "en" && theme === "light" && width === 1440 && ["design", "projects", "detail", "prices"].includes(name))
            || (locale === "kh" && theme === "dark" && width === 375 && ["detail", "design"].includes(name))
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
  await expect(page.getByRole("heading", { name: "デザイン", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "デザイン", exact: true })).toBeVisible();
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
