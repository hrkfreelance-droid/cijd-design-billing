import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildSupabaseSql,
  classifyHistoryRecord,
  importHistory,
  recordsFromCsv,
} from "./import-history.mjs";

function emptyDatabase() {
  return {
    clients: [{ id: "client-rh", name: "Ringer Hut", active: true, createdAt: "2026-08-30T00:00:00.000Z" }],
    projects: [],
    billingItems: [],
    invoices: [],
    invoiceItems: [],
    payments: [],
    users: [],
    auditLogs: [],
    telegramSessions: [],
    notifications: [],
  };
}

const base = {
  project: "Lunch Menu",
  date: "2026-02-01",
  description: "A3 Design",
  amount: "100",
  status: "PAID",
  invoice_number: "",
  invoice_date: "",
  payment_date: "",
};

test("confirmed PAID/INVOICED facts survive unknown administrative fields", () => {
  const paid = classifyHistoryRecord({ ...base, status: "PAID" });
  assert.equal(paid.outcome, "PAID");
  assert.equal(paid.invoiceNumber, null);
  assert.equal(paid.invoiceDate, null);
  assert.equal(paid.paymentDate, null);

  const invoiced = classifyHistoryRecord({ ...base, status: "INVOICED" });
  assert.equal(invoiced.outcome, "INVOICED");
  assert.equal(invoiced.invoiceNumber, null);
  assert.equal(invoiced.invoiceDate, null);
  assert.equal(invoiced.paymentDate, null);
});

test("unknown business facts, contradictions, and duplicate rows need review", () => {
  const missingAmount = classifyHistoryRecord({ ...base, amount: "" });
  assert.equal(missingAmount.outcome, "NEEDS_REVIEW");
  assert.ok(missingAmount.reasons.includes("amount is not confirmed"));

  const missingStatus = classifyHistoryRecord({ ...base, status: "" });
  assert.equal(missingStatus.outcome, "NEEDS_REVIEW");
  assert.ok(missingStatus.reasons.includes("status is not confirmed"));

  const contradiction = classifyHistoryRecord({
    ...base,
    status: "INVOICED",
    payment_date: "2026-02-20",
  });
  assert.equal(contradiction.outcome, "NEEDS_REVIEW");
  assert.ok(contradiction.reasons.some((reason) => reason.includes("conflicts")));

  const db = emptyDatabase();
  const result = importHistory(
    db,
    [base, { ...base }],
    "Ringer Hut",
    { now: "2026-08-30T00:00:00.000Z", idFactory: (() => {
      let n = 0;
      return () => `generated-${++n}`;
    })() },
  );
  assert.equal(result.counts.review, 2);
  assert.equal(db.billingItems.length, 2);
  assert.ok(result.problems.every((problem) => problem.includes("possible duplicate row")));
  assert.equal(db.invoices.length, 0);
});

test("import preserves unknown dates/numbers, links paid history, and keeps additions separate", () => {
  const db = emptyDatabase();
  const records = [
    { ...base },
    {
      ...base,
      description: "SNS Resize",
      amount: "25",
      invoice_number: "RH-002",
      invoice_date: "2026-02-10",
      payment_date: "",
    },
    {
      ...base,
      description: "Print ×40",
      amount: "40",
      status: "INVOICED",
      invoice_number: "",
      invoice_date: "",
    },
    {
      ...base,
      description: "Additional Print ×20",
      amount: "20",
      date: "2026-02-15",
      invoice_number: "RH-003",
      invoice_date: "2026-02-20",
      payment_date: "2026-03-01",
    },
    {
      ...base,
      description: "Unknown Amount",
      amount: "",
      date: "2026-02-16",
    },
  ];
  const result = importHistory(db, records, "Ringer Hut", {
    now: "2026-08-30T00:00:00.000Z",
    idFactory: (() => {
      let n = 0;
      return () => `generated-${++n}`;
    })(),
  });

  assert.equal(result.counts.archived, 3);
  assert.equal(result.counts.invoiced, 1);
  assert.equal(result.counts.review, 1);
  assert.equal(db.projects.length, 1);
  assert.equal(db.billingItems.length, 5);

  const noNumberPaid = db.billingItems.find((item) => item.description === "A3 Design");
  assert.equal(noNumberPaid.billingStatus, "PAID");
  assert.ok(noNumberPaid.invoiceId);
  const noNumberInvoice = db.invoices.find((invoice) => invoice.id === noNumberPaid.invoiceId);
  assert.equal(noNumberInvoice.invoiceNumber, null);
  assert.equal(noNumberInvoice.paymentDate, null);
  assert.equal(db.payments.find((payment) => payment.invoiceId === noNumberInvoice.id).paidAt, null);

  const missingPaymentDate = db.invoices.find((invoice) => invoice.invoiceNumber === "RH-002");
  assert.equal(missingPaymentDate.status, "PAID");
  assert.equal(missingPaymentDate.paymentDate, null);
  assert.equal(db.payments.find((payment) => payment.invoiceId === missingPaymentDate.id).paidAt, null);

  const noNumberInvoiced = db.billingItems.find((item) => item.description === "Print ×40");
  assert.equal(noNumberInvoiced.billingStatus, "INVOICED");
  const awaiting = db.invoices.find((invoice) => invoice.id === noNumberInvoiced.invoiceId);
  assert.equal(awaiting.invoiceNumber, null);
  assert.equal(awaiting.status, "ISSUED");
  assert.equal(awaiting.invoiceDate, null);

  const sameProjectItems = db.billingItems.filter((item) => item.projectId === noNumberPaid.projectId);
  assert.equal(sameProjectItems.length, 5);
  assert.equal(db.invoiceItems.length, 4);

  const sql = buildSupabaseSql(db, "Ringer Hut");
  assert.match(sql, /insert into invoices/);
  assert.match(sql, /insert into invoice_items/);
  assert.match(sql, /insert into payments/);
  assert.match(sql, /invoice_number, invoice_date/);
  assert.match(sql, /, null, null,/);
  assert.match(sql, /billing_status, delivered_at, delivered_by, invoice_id/);
});

test("CSV parser keeps optional unknown fields empty without changing status facts", () => {
  const records = recordsFromCsv(
    [
      "project,date,description,amount,status,invoice_number,invoice_date,payment_date",
      "Lunch Menu,2026-02-01,A3 Design,100,PAID,,,",
    ].join("\n"),
  );
  assert.equal(records.length, 1);
  assert.equal(classifyHistoryRecord(records[0]).outcome, "PAID");
});

test("monthly reconciliation CSV maps facts without trusting a guessed target", () => {
  const records = recordsFromCsv(
    [
      "\uFEFFclient,month,project,billing_item,amount_usd,invoice_fact,payment_fact,invoice_number,invoice_date,target_status,note",
      "Ringer Hut,2026-06,FREE Voucher,Design (2 designs),75,YES,,, ,INVOICED,invoice confirmed",
      "Ringer Hut,2026-06,FREE Voucher,Print 3000,180,YES,,, ,NEEDS_REVIEW,source caution",
      "Ringer Hut,2026-06,FREE Voucher,Unknown,75,,,,,PAID,contradictory target",
    ].join("\n"),
  );

  assert.equal(records.length, 3);
  assert.equal(records[0].date, "2026-06-01");
  assert.equal(records[0].description, "Design (2 designs)");
  assert.equal(classifyHistoryRecord(records[0]).outcome, "INVOICED");
  assert.equal(classifyHistoryRecord(records[1]).outcome, "NEEDS_REVIEW");
  assert.equal(classifyHistoryRecord(records[2]).outcome, "NEEDS_REVIEW");
  assert.match(records[0].note, /exact work date unknown/);
});
