import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

import { buildDemoSeed } from "../src/lib/data/demo-seed";
import { money } from "../src/lib/format";

/**
 * The two rules this app exists to keep:
 *   1. nothing is billed before it is delivered;
 *   2. nothing is billed or paid twice.
 * Each run starts from a throwaway store (.data/test.json, see the config).
 */

async function signIn(page: Page, userId: string) {
  await page.addInitScript(() => {
    localStorage.setItem("cijd.locale", "en");
    localStorage.setItem("cijd.theme", "light");
  });
  const response = await page.request.post("/api/session", { data: { userId } });
  expect(response.ok()).toBeTruthy();
}

async function newProjectWithItem(
  page: Page,
  name: string,
  price = 40,
  type: "DESIGN" | "RESIZE" | "PRINT" | "OTHER" = "DESIGN",
) {
  const project = await (
    await page.request.post("/api/projects", {
      data: { clientId: "cl_ringer_hut", name },
    })
  ).json();
  const item = await (
    await page.request.post("/api/billing-items", {
      data: { projectId: project.data.id, description: "Design", type, unitPrice: price },
    })
  ).json();
  if (type === "PRINT") {
    await signIn(page, "u_admin");
    const reviewed = await page.request.post(`/api/printing-items/${item.data.id}/price`, {
      data: { unitPrice: price, amount: price, confirm: true },
    });
    expect(reviewed.ok()).toBeTruthy();
    await signIn(page, "u_hiroki");
  }
  return { projectId: project.data.id as string, itemId: item.data.id as string };
}

test("designer Hiroki can move work through downstream workspaces", async ({ page }) => {
  await signIn(page, "u_hiroki");
  await page.goto("/designer");
  await expect(page).toHaveURL(/\/designer\/projects$/);
  await expect(page.getByRole("heading", { name: "In Progress", level: 1 })).toBeVisible();
  await expect(page.getByTestId("data-mode")).toHaveCount(0);
  const designerNav = page.locator('nav[aria-label="Workspace navigation"]');
  await expect(designerNav.getByRole("link", { name: "In Progress", exact: true })).toHaveCount(1);
  await expect(designerNav.getByRole("link", { name: "Ready to Invoice", exact: true })).toHaveCount(1);
  await expect(designerNav.getByRole("link", { name: "Archive", exact: true })).toHaveCount(1);
  await expect(designerNav.getByRole("link", { name: /Today|Projects|Delivered/ })).toHaveCount(0);
  // The designer page stays focused, while the workspace switcher exposes the
  // downstream workspaces to Hiroki.
  await expect(page.getByRole("link", { name: "Accounting" })).toHaveCount(0);
  await page.getByRole("button", { name: /Switch workspace/ }).click();
  const workspaces = page.getByRole("dialog", { name: "Switch workspace" });
  await expect(workspaces.getByRole("button", { name: "Printing", exact: true })).toBeVisible();
  await expect(workspaces.getByRole("button", { name: "Billing", exact: true })).toBeVisible();

  const state = await (await page.request.get("/api/state")).json();
  expect(state.data.scope).toEqual({ production: true, billing: true, payment: true });
  expect(state.data.invoices).toEqual([]);

  await workspaces.getByRole("button", { name: "Billing", exact: true }).click();
  await expect(page).toHaveURL(/\/office$/);
  await expect(page.getByRole("link", { name: "Accounting", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Progress", exact: true })).toBeVisible();
  const officeNavHrefs = await page
    .locator('header nav[aria-label="Workspace navigation"] a')
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  expect(officeNavHrefs).toEqual(["/office/progress", "/office", "/office/payments", "/office/archive"]);
});

test("undelivered work cannot reach billing", async ({ page }) => {
  await signIn(page, "u_hiroki");
  const { itemId } = await newProjectWithItem(page, "Gate Check");

  const queue = await page.request.patch(`/api/billing-items/${itemId}`, {
    data: { billingStatus: "READY_TO_INVOICE" },
  });
  expect(queue.status()).toBe(409);
  expect((await queue.json()).code).toBe("NOT_DELIVERED");

  // Even as the role that may invoice, the item is not billable yet.
  await signIn(page, "u_admin");
  const invoice = await page.request.post("/api/invoices", {
    data: {
      clientId: "cl_ringer_hut",
      invoiceNumber: "GATE-1",
      invoiceDate: "2026-01-01",
      billingItemIds: [itemId],
    },
  });
  expect(invoice.status()).toBe(409);
  expect((await invoice.json()).code).toBe("NOT_DELIVERED");
});

test("creative completion and print delivery are independent item actions", async ({ page }) => {
  await signIn(page, "u_hiroki");
  const project = await (
    await page.request.post("/api/projects", {
      data: { clientId: "cl_ringer_hut", name: "Item Action Check" },
    })
  ).json();
  const design = await (
    await page.request.post("/api/billing-items", {
      data: { projectId: project.data.id, description: "Design", type: "DESIGN", unitPrice: 25 },
    })
  ).json();
  const print = await (
    await page.request.post("/api/billing-items", {
      data: {
        projectId: project.data.id,
        description: "Print ×100",
        type: "PRINT",
        quantity: 100,
        unitPrice: 0.15,
        billingStatus: "NEEDS_REVIEW",
      },
    })
  ).json();

  await page.goto(`/designer/projects/${project.data.id}`);
  const designCard = page.getByTestId("designer-project-item").filter({ hasText: "Design" }).first();
  await designCard.getByRole("button", { name: "Complete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Mark as complete" }).click();
  await expect(page.getByText("Marked as complete")).toBeVisible();
  await expect(designCard.getByRole("button", { name: "Undo completion" })).toBeVisible();

  const printCard = page.getByTestId("designer-project-item").filter({ hasText: "Print ×100" }).first();
  await printCard.getByRole("button", { name: "Deliver" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Mark as delivered" }).click();
  await expect(page.getByText("Marked as delivered")).toBeVisible();
  await expect(printCard.getByRole("button", { name: "Undo delivery" })).toBeVisible();

  const state = await (await page.request.get("/api/state")).json();
  const changed = state.data.billingItems.filter(
    (item: { id: string }) => [design.data.id, print.data.id].includes(item.id),
  );
  expect(changed).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: design.data.id, productionStatus: "COMPLETED", billingStatus: "READY_TO_INVOICE" }),
      expect.objectContaining({ id: print.data.id, productionStatus: "DELIVERED", billingStatus: "NEEDS_REVIEW" }),
    ]),
  );

  const wrongForPrint = await page.request.post(`/api/billing-items/${print.data.id}/complete`);
  expect(wrongForPrint.status()).toBe(409);
  expect((await wrongForPrint.json()).code).toBe("WRONG_PRODUCTION_ACTION");
  const wrongForDesign = await page.request.post(`/api/billing-items/${design.data.id}/delivery`);
  expect(wrongForDesign.status()).toBe(409);
  expect((await wrongForDesign.json()).code).toBe("WRONG_PRODUCTION_ACTION");
});

test("delivering hands the work to billing", async ({ page }) => {
  await signIn(page, "u_hiroki");
  const { projectId } = await newProjectWithItem(page, "Handoff Poster", 80, "PRINT");

  await page.goto(`/designer/projects/${projectId}`);
  await expect(page.getByText("In Progress", { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: "Deliver" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Mark as delivered" }).click();
  await expect(page.getByText("Marked as delivered")).toBeVisible();
  await expect(page.getByText("Delivered", { exact: false }).first()).toBeVisible();

  // Billing can invoice the delivered item and can observe unfinished work in
  // the dedicated read-only progress view.
  await signIn(page, "u_billing");
  await page.goto("/office");
  await expect(page.getByRole("button", { name: "Handoff Poster Design" })).toBeVisible();

  const state = await (await page.request.get("/api/state")).json();
  expect(state.data.scope).toEqual({ production: false, billing: true, payment: true });
  expect(state.data.billingItems.some((item: { productionStatus: string }) => item.productionStatus === "IN_PROGRESS")).toBe(true);

  await page.goto("/office/progress");
  await expect(page.getByRole("heading", { name: "Progress", level: 1 })).toBeVisible();
  await expect(page.getByText("Handoff Poster")).toBeVisible();
  await expect(page.getByText("In Progress", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Complete|Deliver|Undo/ })).toHaveCount(0);

});

test("billing and accounting stay out of each other's screens", async ({ page }) => {
  await signIn(page, "u_billing");
  await page.goto("/designer");
  await expect(page).toHaveURL(/\/office$/);
  const asBilling = await page.request.post("/api/projects", {
    data: { clientId: "cl_ringer_hut", name: "Should Fail" },
  });
  expect(asBilling.status()).toBe(403);

  await signIn(page, "u_accounting");
  await page.goto("/designer/projects");
  await expect(page).toHaveURL(/\/office/);
  const asAccounting = await page.request.post("/api/invoices", {
    data: {
      clientId: "cl_ringer_hut",
      invoiceNumber: "ACC-1",
      invoiceDate: "2026-01-01",
      billingItemIds: ["bi_rh_kids_correction"],
    },
  });
  expect(asAccounting.status()).toBe(403);
});

test("billing and accounting can observe progress but cannot mutate production", async ({ page }) => {
  await signIn(page, "u_hiroki");
  const design = await newProjectWithItem(page, "Progress Readonly Design", 40, "DESIGN");
  const print = await newProjectWithItem(page, "Progress Readonly Print", 15, "PRINT");

  await signIn(page, "u_billing");
  await page.goto("/office/progress");
  await expect(page.getByRole("heading", { name: "Progress", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Progress", exact: true })).toHaveAttribute("aria-current", "page");
  const readonly = page.getByTestId("progress-readonly");
  await expect(readonly).toContainText("Progress Readonly Design");
  await expect(readonly).toContainText("In Progress");
  await expect(readonly.getByRole("button")).toHaveCount(0);

  for (const response of [
    await page.request.patch(`/api/billing-items/${design.itemId}`, { data: { description: "Changed" } }),
    await page.request.post(`/api/billing-items/${design.itemId}/complete`),
    await page.request.post(`/api/printing-items/${print.itemId}/price`, {
      data: { unitPrice: 1, amount: 100, confirm: true },
    }),
  ]) {
    expect(response.status()).toBe(403);
  }

  await signIn(page, "u_accounting");
  await page.goto("/office/progress");
  await expect(page.getByTestId("progress-readonly")).toContainText("Progress Readonly Design");
  await expect(page.getByTestId("progress-readonly").getByRole("button")).toHaveCount(0);
  const accountingWrite = await page.request.post(`/api/billing-items/${design.itemId}/delivery`);
  expect(accountingWrite.status()).toBe(403);
});

test("designer can edit and undo work while it is ready to invoice", async ({ page }) => {
  await signIn(page, "u_hiroki");
  const { projectId, itemId } = await newProjectWithItem(page, "Designer Ready Edit", 40, "DESIGN");
  await page.goto(`/designer/projects/${projectId}`);

  const item = page.getByTestId("designer-project-item").filter({ hasText: "Design" }).first();
  await item.getByRole("button", { name: "Complete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Mark as complete" }).click();
  await expect(item.getByRole("button", { name: "Undo completion" })).toBeVisible();

  await item.getByRole("button", { name: "Design", exact: true }).click();
  const editor = page.getByRole("dialog").last();
  await editor.getByLabel("Amount").fill("55");
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Item updated")).toBeVisible();

  let state = await (await page.request.get("/api/state")).json();
  expect(state.data.billingItems.find((candidate: { id: string }) => candidate.id === itemId)).toEqual(
    expect.objectContaining({ amount: 55, productionStatus: "COMPLETED", billingStatus: "READY_TO_INVOICE" }),
  );

  await item.getByRole("button", { name: "Undo completion" }).click();
  await page.getByRole("dialog").last().getByRole("button", { name: "Undo completion" }).click();
  await expect(page.getByText("Completion undone")).toBeVisible();
  state = await (await page.request.get("/api/state")).json();
  expect(state.data.billingItems.find((candidate: { id: string }) => candidate.id === itemId)).toEqual(
    expect.objectContaining({ productionStatus: "IN_PROGRESS", billingStatus: "NOT_READY" }),
  );

  await page.goto("/office");
  await expect(page.getByText("Designer Ready Edit")).toHaveCount(0);
});

test("designer ready tab keeps completed and delivered work editable until invoiced", async ({ page }) => {
  await signIn(page, "u_hiroki");
  const project = await (
    await page.request.post("/api/projects", {
      data: { clientId: "cl_ringer_hut", name: "Designer Ready Print Edit" },
    })
  ).json();
  const design = await (
    await page.request.post("/api/billing-items", {
      data: { projectId: project.data.id, description: "Design", type: "DESIGN", unitPrice: 40 },
    })
  ).json();
  const print = await (
    await page.request.post("/api/billing-items", {
      data: {
        projectId: project.data.id,
        description: "Print ×100",
        type: "PRINT",
        quantity: 100,
        unitPrice: 0.15,
        amount: 15,
        printSize: "Name Card",
      },
    })
  ).json();
  await page.request.post(`/api/printing-items/${print.data.id}/price`, {
    data: { unitPrice: 0.15, amount: 15, confirm: true },
  });

  await page.request.post(`/api/billing-items/${design.data.id}/complete`);
  await page.request.post(`/api/billing-items/${print.data.id}/delivery`);

  await page.goto("/designer/delivered");
  await expect(page.getByRole("heading", { name: "Ready to Invoice", level: 1 })).toBeVisible();
  const projectLink = page.getByRole("link", { name: /Designer Ready Print Edit/ });
  await expect(projectLink).toBeVisible();
  await projectLink.click();
  await expect(page).toHaveURL(new RegExp(`/designer/projects/${project.data.id}\\?from=ready`));

  const designCard = page.getByTestId("designer-project-item").filter({ hasText: "Design" }).first();
  await designCard.getByRole("button", { name: "Design", exact: true }).click();
  const designEditor = page.getByRole("dialog").last();
  await designEditor.getByLabel("Amount").fill("55");
  await designEditor.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Item updated")).toBeVisible();

  const printCard = page.getByTestId("designer-project-item").filter({ hasText: "Print ×100" }).first();
  await printCard.getByRole("button", { name: "Print ×100", exact: true }).click();
  const printEditor = page.getByRole("dialog").last();
  await printEditor.getByLabel("Qty").fill("200");
  await printEditor.getByLabel("Unit price").fill("0.10");
  await printEditor.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Item updated")).toBeVisible();

  let state = await (await page.request.get("/api/state")).json();
  expect(state.data.billingItems.find((item: { id: string }) => item.id === design.data.id)).toEqual(
    expect.objectContaining({ amount: 55, billingStatus: "READY_TO_INVOICE" }),
  );
  expect(state.data.billingItems.find((item: { id: string }) => item.id === print.data.id)).toEqual(
    expect.objectContaining({ quantity: 200, unitPrice: 0.1, amount: 20, billingStatus: "READY_TO_INVOICE", priceReviewStatus: "CONFIRMED" }),
  );

  await printCard.getByRole("button", { name: "Undo delivery" }).click();
  await page.getByRole("dialog").last().getByRole("button", { name: "Undo delivery" }).click();
  await expect(page.getByText("Delivery undone")).toBeVisible();
  await designCard.getByRole("button", { name: "Undo completion" }).click();
  await page.getByRole("dialog").last().getByRole("button", { name: "Undo completion" }).click();
  await expect(page.getByText("Completion undone")).toBeVisible();
  state = await (await page.request.get("/api/state")).json();
  expect(state.data.billingItems.find((item: { id: string }) => item.id === design.data.id)).toEqual(
    expect.objectContaining({ productionStatus: "IN_PROGRESS", billingStatus: "NOT_READY" }),
  );
  expect(state.data.billingItems.find((item: { id: string }) => item.id === print.data.id)).toEqual(
    expect.objectContaining({ productionStatus: "IN_PROGRESS", billingStatus: "NOT_READY" }),
  );
  await page.goto("/designer/delivered");
  await expect(page.getByText("Designer Ready Print Edit")).toHaveCount(0);
});

test("invoice once, pay once", async ({ page }) => {
  await signIn(page, "u_billing");
  await page.goto("/office");

  const group = page.locator("section").filter({ hasText: "Ringer Hut" });
  await expect(group.getByText("RH Kids Promotion").first()).toBeVisible();
  const automaticPdfPromise = page.waitForEvent("download");
  await group.getByRole("button", { name: "Create Invoice" }).click();
  const automaticPdf = await automaticPdfPromise;
  expect(automaticPdf.suggestedFilename()).toMatch(/^CIJD-\d{8}-[A-Z0-9]+\.pdf$/);
  await expect(page).toHaveURL(/\/office\/payments$/);
  const invoicedState = await (await page.request.get("/api/state")).json();
  const created = invoicedState.data.invoices.find(
    (invoice: { status: string }) => invoice.status === "ISSUED",
  );
  expect(created.invoiceNumber).toMatch(/^CIJD-/);

  await page.getByRole("button", { name: new RegExp(created.invoiceNumber) }).click();
  await expect(page.getByRole("button", { name: "PDF", exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Invoice", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`${created.invoiceNumber}.pdf`);
  const pdfPath = await download.path();
  expect(pdfPath).not.toBeNull();
  if (pdfPath) expect(readFileSync(pdfPath).subarray(0, 8).toString()).toBe("%PDF-1.4");
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await signIn(page, "u_hiroki");
  await page.goto("/designer/projects/pj_rh_kids_promotion");
  const invoicedItem = page.getByTestId("designer-project-item").filter({ hasText: "Correction" }).first();
  await expect(invoicedItem.getByRole("button", { name: /Undo/ })).toHaveCount(0);
  await invoicedItem.getByRole("button", { name: "Correction", exact: true }).click();
  const lockedEditor = page.getByRole("dialog").last();
  await expect(lockedEditor.getByText("Awaiting Payment")).toBeVisible();
  await expect(lockedEditor.getByRole("button", { name: "Save" })).toHaveCount(0);
  await lockedEditor.getByRole("button", { name: "Close" }).click();

  const duplicate = await page.request.post("/api/invoices", {
    data: {
      clientId: "cl_ringer_hut",
      invoiceNumber: created.invoiceNumber.toLowerCase(),
      invoiceDate: "2026-01-01",
      billingItemIds: ["bi_rh_kids_correction"],
    },
  });
  expect(duplicate.status()).toBe(409);
  expect((await duplicate.json()).code).toBe("DUPLICATE_INVOICE_NUMBER");

  // Accounting takes it from here.
  await signIn(page, "u_accounting");
  await page.goto("/office/payments");
  await page.getByRole("button", { name: new RegExp(created.invoiceNumber) }).click();
  await page.getByRole("button", { name: "Confirm payment" }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText("Payment confirmed")).toBeVisible();

  const paidState = await (await page.request.get("/api/state")).json();
  const paid = paidState.data.invoices.find((i: { id: string; status: string }) => i.id === created.id);
  const again = await page.request.post(`/api/invoices/${paid.id}/payment`, {
    data: { paymentDate: "2026-01-01" },
  });
  expect(again.status()).toBe(409);
  expect((await again.json()).code).toBe("ALREADY_PAID");

  await page.getByRole("tab", { name: /Receipts/ }).click();
  await page.getByRole("button", { name: new RegExp(created.invoiceNumber) }).click();
  await page.getByRole("button", { name: "Undo payment" }).click();
  await page.getByRole("dialog").last().getByRole("button", { name: "Undo payment" }).click();
  await expect(page.getByText("Payment undone")).toBeVisible();
  await page.getByRole("tab", { name: /Awaiting/ }).click();
  await expect(page.getByRole("button", { name: new RegExp(created.invoiceNumber) })).toBeVisible();

  // Billing owns invoice cancellation; Accounting owns payment confirmation.
  await signIn(page, "u_billing");
  await page.goto("/office/payments");
  await page.getByRole("button", { name: new RegExp(created.invoiceNumber) }).click();
  await page.getByRole("button", { name: "Cancel invoice" }).click();
  await page.getByRole("dialog").last().getByRole("button", { name: "Cancel invoice" }).click();
  await expect(page.getByText("Invoice cancelled")).toBeVisible();
  await page.goto("/office");
  await expect(page.getByRole("button", { name: "Create Invoice" }).first()).toBeVisible();

});

test("retired Telegram and notification endpoints are not exposed", async ({ request }) => {
  const telegram = await request.post("/api/telegram/message", {
    data: { chatId: "x", text: "hello" },
  });
  expect(telegram.status()).toBe(404);
  const notifications = await request.get("/api/notifications");
  expect(notifications.status()).toBe(404);
});

test("office Archive and Completed include historical work without payment facts", async ({ page }) => {
  await signIn(page, "u_billing");
  await page.goto("/office/archive");
  await expect(page.getByRole("heading", { name: "Archive", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Historical records", level: 2 })).toBeVisible();
  await expect(page.getByTestId("historical-record")).not.toHaveCount(0);

  const monthFilter = page.getByRole("combobox", { name: "All months" });
  for (const monthLabel of ["February 2026", "March 2026", "August 2026"]) {
    await expect(monthFilter.locator("option").filter({ hasText: monthLabel })).toHaveCount(1);
  }
  await monthFilter.selectOption("2026-05");
  await expect(page.getByTestId("historical-record").filter({ hasText: "RH Kids Promotion" })).toBeVisible();

  await page.goto("/office/payments");
  await page.getByRole("tab", { name: "Completed" }).click();
  await expect(page.getByRole("heading", { name: "Historical records", level: 2 })).toBeVisible();
  await expect(page.getByTestId("historical-record").filter({ hasText: "RH Kids Promotion" })).toBeVisible();
  await expect(page.getByTestId("historical-record").filter({ hasText: "Historical" }).getByRole("button")).toHaveCount(0);
});

test("receipts move an invoice to completed", async ({ page }) => {
  await signIn(page, "u_hiroki");
  const { projectId } = await newProjectWithItem(page, "Receipt Check", 30, "PRINT");
  await page.request.post(`/api/projects/${projectId}/delivery`);

  await signIn(page, "u_admin");
  const items = await (await page.request.get("/api/state")).json();
  const item = items.data.billingItems.find(
    (i: { projectId: string }) => i.projectId === projectId,
  );
  await page.request.post("/api/invoices", {
    data: {
      clientId: "cl_ringer_hut",
      invoiceNumber: "RCPT-1",
      invoiceDate: "2026-08-01",
      billingItemIds: [item.id],
    },
  });

  await signIn(page, "u_accounting");
  await page.goto("/office/payments");
  await page.getByRole("button", { name: /RCPT-1/ }).click();
  await page.getByRole("button", { name: "Confirm payment" }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText("Payment confirmed")).toBeVisible();

  // Paid, receipt still pending.
  await page.getByRole("tab", { name: /Receipts/ }).click();
  await page.getByRole("button", { name: /RCPT-1/ }).click();
  await page.getByRole("button", { name: "Receipt sent" }).click();
  await expect(page.getByText("Receipt updated")).toBeVisible();

  await page.getByRole("tab", { name: /Completed/ }).click();
  await expect(page.getByRole("button", { name: /RCPT-1/ })).toBeVisible();
});

test("printing review confirms price before delivery and blocks unconfirmed invoices", async ({ page }) => {
  await signIn(page, "u_admin");
  const project = await (
    await page.request.post("/api/projects", {
      data: { clientId: "cl_ringer_hut", name: "Printing Workflow Check" },
    })
  ).json();
  const print = await (
    await page.request.post("/api/billing-items", {
      data: {
        projectId: project.data.id,
        description: "Print ×900",
        type: "PRINT",
        quantity: 900,
        unitPrice: 0.06,
        amount: 54,
        printSize: "Name Card",
        priceSource: "Historical",
        priceReason: "Previous FREE Voucher printing: 3000 = $180; 700 = $42",
      },
    })
  ).json();
  const design = await (
    await page.request.post("/api/billing-items", {
      data: { projectId: project.data.id, description: "Confidential Design", type: "DESIGN", unitPrice: 25 },
    })
  ).json();

  await page.goto("/printing");
  const card = page.getByTestId("printing-item-card").filter({ hasText: "Printing Workflow Check" });
  await expect(card).toContainText("Print ×900");
  await expect(card).toContainText("Needs Review");
  await expect(card).toContainText("$54");
  await expect(card).toContainText("Set price");
  await expect(card).not.toContainText("Historical");
  await expect(card).not.toContainText("Previous FREE Voucher");
  await expect(page.getByText("Confidential Design")).toHaveCount(0);

  const priceResponse = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/printing-items/${print.data.id}/price`) &&
      response.request().method() === "POST" &&
      response.status() === 200,
  );
  await card.getByRole("button", { name: "Set price" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Set price" }).click();
  await priceResponse;
  const confirmed = await (await page.request.get("/api/state")).json();
  expect(confirmed.data.billingItems.find((item: { id: string }) => item.id === print.data.id)).toEqual(
    expect.objectContaining({ productionStatus: "IN_PROGRESS", billingStatus: "NOT_READY", priceReviewStatus: "CONFIRMED" }),
  );

  const orderingCard = page.getByTestId("printing-item-card").filter({ hasText: "Printing Workflow Check" });
  await expect(orderingCard.getByRole("button", { name: "Deliver" })).toBeVisible();
  await orderingCard.getByRole("button", { name: "Deliver" }).click();
  const deliveryResponse = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/billing-items/${print.data.id}/delivery`) &&
      response.request().method() === "POST" &&
      response.status() === 200,
  );
  await page.getByRole("dialog").getByRole("button", { name: "Mark as delivered" }).click();
  await deliveryResponse;
  const delivered = await (await page.request.get("/api/state")).json();
  expect(delivered.data.billingItems.find((item: { id: string }) => item.id === print.data.id)).toEqual(
    expect.objectContaining({ productionStatus: "DELIVERED", billingStatus: "READY_TO_INVOICE" }),
  );

  await orderingCard.getByRole("button", { name: "Undo delivery" }).click();
  await page.getByRole("dialog").last().getByRole("button", { name: "Undo delivery" }).click();
  await expect(page.getByText("Delivery undone")).toBeVisible();
  const undone = await (await page.request.get("/api/state")).json();
  expect(undone.data.billingItems.find((item: { id: string }) => item.id === print.data.id)).toEqual(
    expect.objectContaining({ productionStatus: "IN_PROGRESS" }),
  );

  // A different unconfirmed print remains blocked at the invoice boundary.
  const pending = await (
    await page.request.post("/api/billing-items", {
      data: { projectId: project.data.id, description: "Print pending", type: "PRINT", quantity: 2000, unitPrice: 0 },
    })
  ).json();
  await page.request.post(`/api/billing-items/${pending.data.id}/delivery`);
  const invoice = await page.request.post("/api/invoices", {
    data: { clientId: "cl_ringer_hut", invoiceNumber: "PRINT-GATE-1", invoiceDate: "2026-08-31", billingItemIds: [pending.data.id] },
  });
  expect(invoice.status()).toBe(409);
  expect((await invoice.json()).code).toBe("PRICE_REVIEW_REQUIRED");
  await signIn(page, "u_billing");
  await page.goto("/office");
  const pendingQueue = page.locator("section").filter({ hasText: "Printing price confirmation pending" });
  await expect(pendingQueue.getByText("Waiting for Printing").first()).toBeVisible();
  await expect(pendingQueue.getByRole("checkbox")).toHaveCount(0);
  await expect(pendingQueue.getByRole("button", { name: "Create Invoice" })).toHaveCount(0);
  expect(design.data.id).toBeTruthy();
});

test("printing total derives from quantity and unit price and stays review-required", async ({ page }) => {
  await signIn(page, "u_admin");
  const project = await (
    await page.request.post("/api/projects", {
      data: { clientId: "cl_ringer_hut", name: "Printing Calculation Check" },
    })
  ).json();
  const print = await (
    await page.request.post("/api/billing-items", {
      data: {
        projectId: project.data.id,
        description: "Print ×2000",
        type: "PRINT",
        quantity: 2000,
        unitPrice: 0.15,
        amount: 300,
        printSize: "Name Card",
      },
    })
  ).json();

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/printing");
    const card = page.getByTestId("printing-item-card").filter({ hasText: "Printing Calculation Check" });
    await card.getByRole("button", { name: "Set price" }).click();
    const dialog = page.getByRole("dialog");
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox).not.toBeNull();
    const layout = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const buttons = Array.from(element.querySelectorAll("button"), (button) => {
        const buttonRect = button.getBoundingClientRect();
        return { left: buttonRect.left, right: buttonRect.right, bottom: buttonRect.bottom };
      });
      return {
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        buttons,
      };
    });
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
    expect(layout.buttons.every((button) => button.left >= layout.left - 1 && button.right <= layout.right + 1)).toBeTruthy();
    expect(layout.buttons.every((button) => button.bottom <= layout.bottom + 1)).toBeTruthy();

    const quantity = dialog.getByLabel("Quantity");
    const unitPrice = dialog.getByLabel("Unit price");
    const total = dialog.getByTestId("printing-total");
    await expect(total).toHaveValue("300.00");
    await expect(total).toHaveAttribute("readonly", "");
    await quantity.fill("100");
    await expect(total).toHaveValue("15.00");
    await unitPrice.fill("0.20");
    await expect(total).toHaveValue("20.00");
    await dialog.getByRole("button", { name: "Cancel" }).click();
  }

  // A stale total is rejected at the server-side repository boundary.
  const stale = await page.request.post(`/api/printing-items/${print.data.id}/price`, {
    data: { unitPrice: 0.2, amount: 15, confirm: false },
  });
  expect(stale.status()).toBe(400);
  expect((await stale.json()).code).toBe("INVALID");
  const unchanged = await (await page.request.get("/api/state")).json();
  expect(unchanged.data.billingItems.find((item: { id: string }) => item.id === print.data.id)).toEqual(
    expect.objectContaining({ amount: 300, priceReviewStatus: "REVIEW_REQUIRED" }),
  );
});

test("unconfirmed print price is prioritized over delivery in the designer list", async ({ page }) => {
  await signIn(page, "u_hiroki");
  const project = await (
    await page.request.post("/api/projects", {
      data: { clientId: "cl_ringer_hut", name: "Price Review Priority Check" },
    })
  ).json();
  await page.request.post("/api/billing-items", {
    data: {
      projectId: project.data.id,
      description: "Print ×100",
      type: "PRINT",
      quantity: 100,
      unitPrice: 0.15,
      amount: 15,
      printSize: "Name Card",
      priceSource: "Historical",
      priceReason: "Previous run: 100 = $15",
    },
  });

  await page.goto("/designer/projects");
  const item = page
    .getByTestId("designer-project-group")
    .filter({ hasText: "Price Review Priority Check" })
    .getByTestId("designer-project-item")
    .filter({ hasText: "Print ×100" });
  const review = item.getByRole("link", { name: "Review price" });
  const deliver = item.getByRole("button", { name: "Deliver" });

  await expect(review).toBeVisible();
  await expect(deliver).toBeVisible();
  await expect(review).toHaveClass(/bg-accent/);
  await expect(deliver).toHaveClass(/bg-panel/);

  const actions = await item.locator("a,button").allTextContents();
  expect(actions.indexOf("Review price")).toBeGreaterThanOrEqual(0);
  expect(actions.indexOf("Deliver")).toBeGreaterThanOrEqual(0);
  expect(actions.indexOf("Review price")).toBeLessThan(actions.indexOf("Deliver"));
});

test("designer price display does not infer certainty from note text", async ({ page }) => {
  await signIn(page, "u_hiroki");
  const project = await (
    await page.request.post("/api/projects", {
      data: { clientId: "cl_ringer_hut", name: "Structured Price State Check" },
    })
  ).json();
  await page.request.post("/api/billing-items", {
    data: {
      projectId: project.data.id,
      description: "Design",
      type: "DESIGN",
      unitPrice: 25,
      note: "Suggested by an old note, not a price review decision",
    },
  });

  await page.goto("/designer/projects");
  const item = page
    .getByTestId("designer-project-group")
    .filter({ hasText: "Structured Price State Check" })
    .getByTestId("designer-project-item")
    .filter({ hasText: "Design" });
  await expect(item).toBeVisible();
  await expect(item.getByText("Suggested", { exact: false })).toHaveCount(0);
});

test("designer uses one project card and keeps nested actions local", async ({ page }) => {
  await signIn(page, "u_hiroki");
  const project = await (
    await page.request.post("/api/projects", {
      data: { clientId: "cl_ringer_hut", name: "Project Card Navigation Check" },
    })
  ).json();
  await page.request.post("/api/billing-items", {
    data: { projectId: project.data.id, description: "Design", type: "DESIGN", unitPrice: 25 },
  });
  await page.request.post("/api/billing-items", {
    data: {
      projectId: project.data.id,
      description: "Print ×100",
      type: "PRINT",
      quantity: 100,
      unitPrice: 0.15,
      amount: 15,
      billingStatus: "NEEDS_REVIEW",
    },
  });

  await page.goto("/designer/projects");
  const card = page.getByTestId("designer-project-group").filter({ hasText: "Project Card Navigation Check" });
  await expect(card).toHaveCount(1);
  await expect(card.getByTestId("designer-project-item")).toHaveCount(2);

  // The project container is keyboard/click navigable as one unit.
  await card.click({ position: { x: 8, y: 8 } });
  await expect(page).toHaveURL(new RegExp(`/designer/projects/${project.data.id}$`));

  // A nested production action opens its own confirmation sheet and must not
  // fall through to the containing project's navigation handler.
  await page.goto("/designer/projects");
  const design = card.getByTestId("designer-project-item").filter({ hasText: "Design" });
  await design.getByRole("button", { name: "Complete" }).click();
  await expect(page).toHaveURL(/\/designer\/projects$/);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

  const print = card.getByTestId("designer-project-item").filter({ hasText: "Print ×100" });
  await print.getByRole("link", { name: "Review price" }).click();
  await expect(page).toHaveURL(new RegExp(`/designer/projects/${project.data.id}\\?item=`));
});

test("admin switches workspaces from the current workspace title", async ({ page }) => {
  await signIn(page, "u_admin");
  await page.goto("/designer/projects");
  await page.getByRole("button", { name: /Switch workspace/ }).click();
  const dialog = page.getByRole("dialog", { name: "Switch workspace" });
  await expect(dialog.getByRole("button", { name: "Design", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Printing", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Billing", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Printing", exact: true }).click();
  await expect(page).toHaveURL(/\/printing$/);
});

test("printing navigation stays focused on printing and history", async ({ page }) => {
  await signIn(page, "u_admin");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/printing");
  const printingNav = page.locator('nav[aria-label="Workspace navigation"]');
  await expect(printingNav.getByRole("link", { name: "Printing", exact: true })).toBeVisible();
  await expect(printingNav.getByRole("link", { name: "History", exact: true })).toBeVisible();
  await expect(printingNav.getByRole("link", { name: /Review|Ordering|Delivered/ })).toHaveCount(0);
});

test("demo users keep Hiroki as the downstream-capable Designer", () => {
  const preview = buildDemoSeed();
  const users = preview.users;
  expect(users).toEqual([
    { id: "u_hiroki", name: "Hiroki", role: "DESIGNER" },
    { id: "u_printing", name: "Printing Staff", role: "PRINTING" },
    { id: "u_billing", name: "Billing Staff", role: "BILLING" },
    { id: "u_accounting", name: "Accounting", role: "ACCOUNTING" },
  ]);
  expect(users.filter((user) => user.role === "DESIGNER")).toHaveLength(1);
  const kidsItems = preview.billingItems.filter((item) => item.projectId === "pj_rh_kids_promotion");
  expect(kidsItems.map((item) => item.description)).toEqual(expect.arrayContaining(["Revision", "iStand"]));
  expect(kidsItems.some((item) => item.id === "bi_rh_kids_correction")).toBe(false);
});

test("progress keeps embedded print quantities to one display", async ({ page }) => {
  await signIn(page, "u_hiroki");
  const project = await (
    await page.request.post("/api/projects", {
      data: { clientId: "cl_ringer_hut", name: "Progress Quantity Display Check" },
    })
  ).json();
  const rows = [
    ["Print ×2000", 2000],
    ["Print x900", 900],
    ["Print 100", 100],
    ["Additional Print 1500", 1500],
  ] as const;
  const created: { id: string; description: string; quantity: number }[] = [];
  for (const [description, quantity] of rows) {
    const response = await page.request.post("/api/billing-items", {
      data: {
        projectId: project.data.id,
        description,
        type: "PRINT",
        quantity,
        unitPrice: 0,
      },
    });
    const body = await response.json();
    created.push({ id: body.data.id, description, quantity });
  }

  await signIn(page, "u_billing");
  await page.goto("/office/progress");
  const progressProject = page.getByTestId(`progress-project-${project.data.id}`);
  for (const row of created) {
    await expect(progressProject.getByText(row.description, { exact: true })).toHaveCount(1);
    await expect(progressProject).not.toContainText(`${row.description} ×${row.quantity}`);
  }

  const state = await (await page.request.get("/api/state")).json();
  for (const row of created) {
    expect(state.data.billingItems.find((item: { id: string }) => item.id === row.id)).toEqual(
      expect.objectContaining({ description: row.description, quantity: row.quantity }),
    );
  }
});

test("Billing and Accounting totals follow the selected client and tab", async ({ page }) => {
  async function createReady(clientId: string, name: string, amount: number) {
    const project = await (
      await page.request.post("/api/projects", { data: { clientId, name } })
    ).json();
    const item = await (
      await page.request.post("/api/billing-items", {
        data: { projectId: project.data.id, description: "Design", type: "DESIGN", unitPrice: amount },
      })
    ).json();
    const completed = await page.request.post(`/api/billing-items/${item.data.id}/complete`);
    expect(completed.ok()).toBeTruthy();
    return { clientId, itemId: item.data.id as string };
  }

  await signIn(page, "u_hiroki");
  const ringer = await createReady("cl_ringer_hut", "Billing Total Ringer Hut", 40);
  const daishin = await createReady("cl_daishin", "Billing Total DAISHIN", 25);

  await signIn(page, "u_billing");
  const readyState = await (await page.request.get("/api/state")).json();
  const projectClients = new Map(
    readyState.data.projects.map((project: { id: string; clientId: string }) => [project.id, project.clientId]),
  );
  const readyItems = readyState.data.billingItems.filter(
    (item: { projectId: string; createdBy: string; productionStatus: string; billingStatus: string }) =>
      item.createdBy !== "Import" &&
      ["COMPLETED", "DELIVERED"].includes(item.productionStatus) &&
      item.billingStatus === "READY_TO_INVOICE",
  );
  const totalFor = (clientId?: string) =>
    readyItems
      .filter((item: { projectId: string }) => !clientId || projectClients.get(item.projectId) === clientId)
      .reduce((total: number, item: { amount: number }) => total + item.amount, 0);

  await page.goto("/office");
  await expect(page.getByTestId("page-total")).toContainText(money(totalFor()));
  await page.getByRole("button", { name: "Ringer Hut", exact: true }).click();
  await expect(page.getByTestId("page-total")).toContainText(money(totalFor("cl_ringer_hut")));
  await page.getByRole("button", { name: "All Clients", exact: true }).click();

  const ringerInvoice = await (
    await page.request.post("/api/invoices", {
      data: { clientId: ringer.clientId, invoiceNumber: "TOTAL-RH-1", invoiceDate: "2026-09-01", billingItemIds: [ringer.itemId] },
    })
  ).json();
  const daishinInvoice = await (
    await page.request.post("/api/invoices", {
      data: { clientId: daishin.clientId, invoiceNumber: "TOTAL-DAISHIN-1", invoiceDate: "2026-09-01", billingItemIds: [daishin.itemId] },
    })
  ).json();

  await signIn(page, "u_accounting");
  await page.goto("/office/payments");
  const invoices = await (await page.request.get("/api/state")).json();
  const invoiceTotal = (status: string, receiptStatus?: string, clientId?: string) =>
    invoices.data.invoices
      .filter((invoice: { status: string; receiptStatus: string; clientId: string }) =>
        invoice.status === status && (!receiptStatus || invoice.receiptStatus === receiptStatus) && (!clientId || invoice.clientId === clientId),
      )
      .reduce((total: number, invoice: { amount: number }) => total + invoice.amount, 0);
  await expect(page.getByTestId("page-total")).toContainText(money(invoiceTotal("ISSUED")));
  await page.getByRole("button", { name: "Ringer Hut", exact: true }).click();
  await expect(page.getByTestId("page-total")).toContainText(money(invoiceTotal("ISSUED", undefined, "cl_ringer_hut")));
  await page.getByRole("button", { name: "All Clients", exact: true }).click();

  const paid = await page.request.post(`/api/invoices/${ringerInvoice.data.id}/payment`, {
    data: { paymentDate: "2026-09-01", slip: "" },
  });
  expect(paid.ok()).toBeTruthy();
  await page.reload();
  await page.getByRole("tab", { name: /Receipts/ }).click();
  const receiptState = await (await page.request.get("/api/state")).json();
  const receiptTotal = receiptState.data.invoices
    .filter((invoice: { status: string; receiptStatus: string }) => invoice.status === "PAID" && invoice.receiptStatus === "PENDING")
    .reduce((total: number, invoice: { amount: number }) => total + invoice.amount, 0);
  await expect(page.getByTestId("page-total")).toContainText(money(receiptTotal));

  const receiptUpdated = await page.request.patch(`/api/invoices/${ringerInvoice.data.id}`, {
    data: { receiptStatus: "RECEIVED" },
  });
  expect(receiptUpdated.ok()).toBeTruthy();
  await page.reload();
  await page.getByRole("tab", { name: /Completed/ }).click();
  const completedState = await (await page.request.get("/api/state")).json();
  const completedTotal = completedState.data.invoices
    .filter((invoice: { status: string; receiptStatus: string }) => invoice.status === "PAID" && invoice.receiptStatus !== "PENDING")
    .reduce((total: number, invoice: { amount: number }) => total + invoice.amount, 0);
  const historicalTotal = completedState.data.billingItems
    .filter((item: { createdBy: string }) => item.createdBy === "Import")
    .reduce((total: number, item: { amount: number }) => total + item.amount, 0);
  await expect(page.getByTestId("page-total")).toContainText(money(completedTotal + historicalTotal));
  expect(daishinInvoice.data.id).toBeTruthy();

  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    for (const path of ["/office", "/office/payments"]) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${path} horizontal overflow at ${width}px`).toBe(0);
    }
  }
});
