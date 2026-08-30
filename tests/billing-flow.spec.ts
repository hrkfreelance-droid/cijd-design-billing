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

async function newProjectWithItem(page: Page, name: string, price = 40) {
  const project = await (
    await page.request.post("/api/projects", {
      data: { clientId: "cl_ringer_hut", name },
    })
  ).json();
  const item = await (
    await page.request.post("/api/billing-items", {
      data: { projectId: project.data.id, description: "Design", unitPrice: price },
    })
  ).json();
  return { projectId: project.data.id as string, itemId: item.data.id as string };
}

test("designer sees production, not invoicing", async ({ page }) => {
  await signIn(page, "u_hiroki");
  await page.goto("/designer");
  await expect(page.getByRole("heading", { name: "Today", level: 1 })).toBeVisible();
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

test("delivering hands the work to billing and records a notification", async ({ page }) => {
  await signIn(page, "u_hiroki");
  const { projectId } = await newProjectWithItem(page, "Handoff Poster", 80);

  await page.goto(`/designer/projects/${projectId}`);
  await expect(page.getByText("Not delivered")).toBeVisible();
  await page.getByRole("button", { name: "Mark as delivered" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Mark as delivered" }).click();
  await expect(page.getByText("Marked as delivered")).toBeVisible();
  await expect(page.getByText("Delivered", { exact: false }).first()).toBeVisible();

  // Billing now sees it, and only it — nothing undelivered.
  await signIn(page, "u_billing");
  await page.goto("/office");
  await expect(page.getByText("Only delivered work appears here.")).toBeVisible();
  await expect(page.getByText("Handoff Poster")).toBeVisible();
  await expect(page.getByText("Gate Check")).toHaveCount(0);

  const state = await (await page.request.get("/api/state")).json();
  expect(state.data.scope).toEqual({ production: false, billing: true, payment: false });
  expect(
    state.data.billingItems.every((item: { productionStatus: string }) => item.productionStatus === "DELIVERED"),
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
    data: { projectId: project.id, description: "Poster Design", unitPrice: 120 },
  });

  const delivered = await send("納品済み");
  expect((await delivered.json()).data.reply).toContain("納品済み");

  const after = await (await request.get("/api/state")).json();
  const item = after.data.billingItems.find(
    (i: { projectId: string }) => i.projectId === project.id,
  );
  expect(item.productionStatus).toBe("DELIVERED");
  expect(item.billingStatus).toBe("READY_TO_INVOICE");

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
  const { projectId } = await newProjectWithItem(page, "Receipt Check", 30);
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
  const { projectId } = await newProjectWithItem(page, "Notify Check", 20);
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
