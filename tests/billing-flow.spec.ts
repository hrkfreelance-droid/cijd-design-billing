import { expect, test, type Page } from "@playwright/test";

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

test("designer sees production, not invoicing", async ({ page }) => {
  await signIn(page, "u_hiroki");
  await page.goto("/designer");
  await expect(page.getByRole("heading", { name: "Today", level: 1 })).toBeVisible();
  await expect(page.getByTestId("data-mode")).toHaveText("LOCAL MODE");
  await expect(page.getByRole("link", { name: "Delivered" }).first()).toBeVisible();
  // No billing navigation anywhere on the designer side.
  await expect(page.getByRole("link", { name: "Payments" })).toHaveCount(0);

  const state = await (await page.request.get("/api/state")).json();
  expect(state.data.scope).toEqual({ production: true, billing: false, payment: false });
  expect(state.data.invoices).toEqual([]);

  // And no way to invoice, even by calling the endpoint directly.
  const attempt = await page.request.post("/api/invoices", {
    data: {
      clientId: "cl_ringer_hut",
      invoiceNumber: "X-1",
      invoiceDate: "2026-01-01",
      billingItemIds: ["bi_rh_kids_correction"],
    },
  });
  expect(attempt.status()).toBe(403);
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

test("delivering hands the work to billing and records a notification", async ({ page }) => {
  await signIn(page, "u_hiroki");
  const { projectId } = await newProjectWithItem(page, "Handoff Poster", 80, "PRINT");

  await page.goto(`/designer/projects/${projectId}`);
  await expect(page.getByText("In Progress", { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: "Deliver" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Mark as delivered" }).click();
  await expect(page.getByText("Marked as delivered")).toBeVisible();
  await expect(page.getByText("Delivered", { exact: false }).first()).toBeVisible();

  // Billing now sees it, and only it — nothing undelivered.
  await signIn(page, "u_billing");
  await page.goto("/office");
  await expect(page.getByText("Only work with completed production appears here.")).toBeVisible();
  await expect(page.getByText("Handoff Poster")).toBeVisible();
  await expect(page.getByText("Gate Check")).toHaveCount(0);

  const state = await (await page.request.get("/api/state")).json();
  expect(state.data.scope).toEqual({ production: false, billing: true, payment: false });
  expect(
    state.data.billingItems.every((item: { productionStatus: string }) =>
      ["DELIVERED", "COMPLETED"].includes(item.productionStatus),
    ),
  ).toBe(true);

  // The delivery notification is recorded even though Telegram is unconfigured.
  const notifications = await (await page.request.get("/api/notifications")).json();
  const notice = notifications.data.find((n: { text: string }) => n.text.includes("Handoff Poster"));
  expect(notice).toBeTruthy();
  expect(notice.status).toBe("SKIPPED");
  expect(notice.text).toContain("Ready to invoice.");
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

test("invoice once, pay once", async ({ page }) => {
  await signIn(page, "u_billing");
  await page.goto("/office");

  const group = page.locator("section").filter({ hasText: "Ringer Hut" });
  await expect(group.getByText("RH Kids Promotion").first()).toBeVisible();
  await group.getByRole("button", { name: "Mark as Invoiced" }).click();
  await page.getByLabel("Invoice number").fill("TEST-0001");
  await page.getByRole("button", { name: "Create invoice" }).click();
  await expect(page.getByText("Invoice TEST-0001 created")).toBeVisible();

  const duplicate = await page.request.post("/api/invoices", {
    data: {
      clientId: "cl_ringer_hut",
      invoiceNumber: "test-0001",
      invoiceDate: "2026-01-01",
      billingItemIds: ["bi_rh_kids_correction"],
    },
  });
  expect(duplicate.status()).toBe(409);
  expect((await duplicate.json()).code).toBe("DUPLICATE_INVOICE_NUMBER");

  // Accounting takes it from here.
  await signIn(page, "u_accounting");
  await page.goto("/office/payments");
  await page.getByRole("button", { name: /TEST-0001/ }).click();
  await page.getByRole("button", { name: "Confirm payment" }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText("Payment confirmed")).toBeVisible();

  const state = await (await page.request.get("/api/state")).json();
  const paid = state.data.invoices.find((i: { status: string }) => i.status === "PAID");
  const again = await page.request.post(`/api/invoices/${paid.id}/payment`, {
    data: { paymentDate: "2026-01-01" },
  });
  expect(again.status()).toBe(409);
  expect((await again.json()).code).toBe("ALREADY_PAID");
});

test("telegram registers a project and delivers it", async ({ request }) => {
  // The bot speaks to the app with its own secret; reading state needs a session.
  await request.post("/api/session", { data: { userId: "u_hiroki" } });
  const send = (text: string) =>
    request.post("/api/telegram/message", {
      headers: { "x-telegram-secret": "test-secret" },
      data: { chatId: "test-chat", text },
    });

  const registered = await send("RH New Menu Poster");
  expect(registered.ok()).toBeTruthy();
  expect((await registered.json()).data.reply).toContain("RH New Menu Poster");

  // Nothing to bill yet, so delivery is refused with an explanation.
  const tooEarly = await send("納品済み");
  expect((await tooEarly.json()).data.reply).toContain("請求項目");

  const state = await (await request.get("/api/state")).json();
  const project = state.data.projects.find(
    (p: { name: string }) => p.name === "RH New Menu Poster",
  );
  expect(project.createdBy).toBe("Hiroki");
  await request.post("/api/billing-items", {
    data: { projectId: project.id, description: "Poster Design", type: "PRINT", unitPrice: 120 },
  });

  const delivered = await send("納品済み");
  expect((await delivered.json()).data.reply).toContain("納品済み");

  const after = await (await request.get("/api/state")).json();
  const item = after.data.billingItems.find(
    (i: { projectId: string }) => i.projectId === project.id,
  );
  expect(item.productionStatus).toBe("DELIVERED");
  expect(item.billingStatus).toBe("NEEDS_REVIEW");
  await request.post("/api/session", { data: { userId: "u_admin" } });
  const notifications = await (await request.get("/api/notifications")).json();
  expect(notifications.data.at(-1).text).toContain("Price review required before invoicing.");

  const unknown = await send("Unknown Project 納品済み");
  expect((await unknown.json()).data.reply).toContain("見つかりません");
});

test("the bot endpoint refuses a bad secret", async ({ request }) => {
  const response = await request.post("/api/telegram/message", {
    headers: { "x-telegram-secret": "wrong" },
    data: { chatId: "x", text: "hello" },
  });
  expect(response.status()).toBe(403);
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
  await page.getByRole("tab", { name: /Receipt/ }).click();
  await page.getByRole("button", { name: /RCPT-1/ }).click();
  await page.getByRole("button", { name: "Receipt sent" }).click();
  await expect(page.getByText("Receipt updated")).toBeVisible();

  await page.getByRole("tab", { name: /Completed/ }).click();
  await expect(page.getByRole("button", { name: /RCPT-1/ })).toBeVisible();
});

test("a failed delivery notification can be resent", async ({ page }) => {
  await signIn(page, "u_hiroki");
  const { projectId } = await newProjectWithItem(page, "Notify Check", 20, "PRINT");
  await page.request.post(`/api/projects/${projectId}/delivery`);

  await signIn(page, "u_billing");
  const before = await (await page.request.get("/api/notifications")).json();
  const notice = before.data.find((n: { text: string }) => n.text.includes("Notify Check"));
  expect(notice.status).toBe("SKIPPED");

  // Telegram is unconfigured, so a resend reports that rather than failing.
  const resend = await page.request.post(`/api/notifications/${notice.id}/resend`);
  expect(resend.ok()).toBeTruthy();
  const after = await (await page.request.get("/api/notifications")).json();
  const updated = after.data.find((n: { id: string }) => n.id === notice.id);
  expect(updated.attempts).toBeGreaterThan(notice.attempts);
  expect(updated.status).toBe("SKIPPED");

  // The delivery itself is untouched by the notification problem.
  await signIn(page, "u_admin");
  const state = await (await page.request.get("/api/state")).json();
  const item = state.data.billingItems.find(
    (i: { projectId: string }) => i.projectId === projectId,
  );
  expect(item.productionStatus).toBe("DELIVERED");
  expect(item.billingStatus).toBe("READY_TO_INVOICE");
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
  await expect(card).toContainText("Suggested");
  await expect(card).toContainText("$54");
  await expect(page.getByText("Confidential Design")).toHaveCount(0);

  const priceResponse = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/printing-items/${print.data.id}/price`) &&
      response.request().method() === "POST" &&
      response.status() === 200,
  );
  await card.getByRole("button", { name: "Confirm this price" }).click();
  await priceResponse;
  const confirmed = await (await page.request.get("/api/state")).json();
  expect(confirmed.data.billingItems.find((item: { id: string }) => item.id === print.data.id)).toEqual(
    expect.objectContaining({ productionStatus: "IN_PROGRESS", billingStatus: "NOT_READY", priceReviewStatus: "CONFIRMED" }),
  );

  await page.goto("/printing/ordering");
  const orderingCard = page.getByTestId("printing-item-card").filter({ hasText: "Printing Workflow Check" });
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
    await card.getByRole("button", { name: "Edit specs & price" }).click();
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
