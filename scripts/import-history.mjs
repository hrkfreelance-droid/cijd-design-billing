/**
 * Imports confirmed historical billing records.
 *
 *   npm run import:history -- history.csv "Ringer Hut"
 *
 * A historical row is archived when the amount and the business facts are
 * confirmed. Administrative fields such as an invoice number or payment date
 * may be unknown; those values are preserved as null instead of changing a
 * confirmed record into NEEDS_REVIEW. Rows with an unknown fact, a
 * contradiction, or a duplicate suspicion remain NEEDS_REVIEW.
 *
 * Canonical CSV columns (header required, order free):
 *   project        RH Lunch Menu            required
 *   date           2026-03-14               required, yyyy-mm-dd
 *   description    A3 Design                required
 *   amount         125                      required, confirmed amount
 *   quantity       1                        optional (default 1)
 *   unit_price     125                      optional
 *   type           DESIGN|RESIZE|PRINT|OTHER  optional (default OTHER)
 *   status         PAID|INVOICED|REVIEW     required business fact
 *   invoice_number RH-0138                  optional
 *   invoice_date   2026-03-20               optional
 *   payment_date   2026-04-10               optional for PAID
 *   note           free text                optional
 *
 * Monthly reconciliation CSVs are also accepted. Their month is stored as a
 * month bucket (YYYY-MM-01) because the exact work day is not known; the
 * original limitation is retained in the item's note.
 *   client,month,project,billing_item,amount_usd,invoice_fact,payment_fact,
 *   invoice_number,invoice_date,target_status,note
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VALID_STATUSES = new Set(["PAID", "INVOICED", "REVIEW", ""]);
const VALID_TYPES = new Set(["DESIGN", "RESIZE", "PRINT", "OTHER"]);
const UNKNOWN_VALUES = new Set(["", "UNKNOWN", "N/A", "NA", "-"]);
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Empty/explicitly unknown administrative values become database nulls. */
export function nullableText(value) {
  const text = value == null ? "" : String(value).trim();
  return UNKNOWN_VALUES.has(text.toUpperCase()) ? null : text;
}

/** Accepts an actual calendar date, not only a string with the right shape. */
export function isDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function isMonth(value) {
  if (typeof value !== "string" || !MONTH_PATTERN.test(value)) return false;
  const [year, month] = value.split("-").map(Number);
  return year >= 1 && month >= 1 && month <= 12;
}

/* ------------------------------------------------------------------- csv */
function rowRecord(header, line) {
  const record = {};
  header.forEach((name, index) => {
    record[name] = (line[index] ?? "").trim();
  });
  return record;
}

function factValue(value) {
  const text = nullableText(value);
  if (text === null) return null;
  const normalized = text.toUpperCase();
  if (["YES", "TRUE", "CONFIRMED"].includes(normalized)) return "YES";
  if (["NO", "FALSE", "UNCONFIRMED"].includes(normalized)) return "NO";
  return null;
}

function targetStatus(value) {
  const text = nullableText(value);
  if (text === null) return null;
  const normalized = text.toUpperCase();
  return normalized === "NEEDS_REVIEW" ? "REVIEW" : normalized;
}

function appendNote(note, addition) {
  const existing = nullableText(note);
  return existing ? `${existing}; ${addition}` : addition;
}

function monthlyItemType(value) {
  const text = (nullableText(value) ?? "").toUpperCase();
  if (text.includes("DESIGN")) return "DESIGN";
  if (text.includes("RESIZE")) return "RESIZE";
  if (text.includes("PRINT")) return "PRINT";
  return "OTHER";
}

function monthlyRecord(source) {
  const month = nullableText(source.month);
  const invoiceFact = factValue(source.invoice_fact);
  const paymentFact = factValue(source.payment_fact);
  const declared = targetStatus(source.target_status);
  let status = "REVIEW";

  if (invoiceFact === "YES" && paymentFact === "YES") status = "PAID";
  else if (invoiceFact === "YES" && paymentFact !== "YES") status = "INVOICED";

  let note = nullableText(source.note);
  if (month && isMonth(month)) {
    note = appendNote(note, `Historical month ${month}; exact work date unknown`);
  }

  // The source target is a safety signal, not a substitute for the facts.
  // A review target always remains review; a conflicting positive target is
  // downgraded instead of allowing an unsafe archive or invoice link.
  if (declared === "REVIEW") status = "REVIEW";
  else if (declared && declared !== status) {
    status = "REVIEW";
    note = appendNote(note, `Source target_status ${declared} conflicts with invoice/payment facts`);
  }

  return {
    client: nullableText(source.client),
    project: source.project,
    date: month && isMonth(month) ? `${month}-01` : "",
    description: source.billing_item,
    amount: source.amount_usd,
    status,
    invoice_number: source.invoice_number,
    invoice_date: source.invoice_date,
    payment_date: source.payment_date,
    type: monthlyItemType(source.billing_item),
    note,
  };
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field !== "" || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((line) => line.some((cell) => cell.trim() !== ""));
}

export function recordsFromCsv(text) {
  const raw = parseCsv(text);
  if (!raw.length) throw new Error("CSV header is required.");
  const header = raw[0].map((name) => name.replace(/^\uFEFF/, "").trim().toLowerCase());
  const monthlyColumns = [
    "client",
    "month",
    "project",
    "billing_item",
    "amount_usd",
    "invoice_fact",
    "payment_fact",
    "target_status",
  ];
  if (monthlyColumns.every((name) => header.includes(name))) {
    return raw.slice(1).map((line) => monthlyRecord(rowRecord(header, line)));
  }
  const required = ["project", "date", "description", "amount", "status"];
  const missing = required.filter((name) => !header.includes(name));
  if (missing.length) throw new Error(`CSV header is missing: ${missing.join(", ")}`);
  return raw.slice(1).map((line) => rowRecord(header, line));
}

/* --------------------------------------------------------------- checking */
function numberOrNull(value) {
  const text = nullableText(value);
  if (text === null) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Classifies one row using only the facts in that row. This is exported so
 * the import rule can be tested without touching the local database.
 */
export function classifyHistoryRecord(record) {
  const project = nullableText(record.project);
  const description = nullableText(record.description);
  const workDate = nullableText(record.date);
  const amountText = nullableText(record.amount);
  const amount = amountText === null ? null : Number(amountText);
  const declared = (nullableText(record.status) ?? "").toUpperCase();
  const invoiceNumber = nullableText(record.invoice_number);
  const invoiceDate = nullableText(record.invoice_date);
  const paymentDate = nullableText(record.payment_date);
  const quantity = numberOrNull(record.quantity);
  const unitPrice = numberOrNull(record.unit_price);
  const type = (nullableText(record.type) ?? "OTHER").toUpperCase();
  const reasons = [];

  if (!project) reasons.push("project is missing");
  if (!description) reasons.push("description is missing");
  if (!isDate(workDate)) reasons.push("date is missing or not yyyy-mm-dd");
  if (amount === null || !Number.isFinite(amount)) reasons.push("amount is not confirmed");
  else if (amount < 0) reasons.push("amount is invalid");
  if (record.quantity && (quantity === null || quantity < 0)) {
    reasons.push("quantity is invalid");
  }
  if (record.unit_price && (unitPrice === null || unitPrice < 0)) {
    reasons.push("unit price is invalid");
  }
  if (!VALID_TYPES.has(type)) reasons.push(`unknown type "${record.type}"`);
  if (!VALID_STATUSES.has(declared)) reasons.push(`unknown status "${record.status}"`);
  if (declared === "" || declared === "REVIEW") reasons.push("status is not confirmed");

  // These are optional administrative fields. If supplied, malformed values
  // are a contradiction; if absent, the confirmed business fact still stands.
  if (invoiceDate !== null && !isDate(invoiceDate)) {
    reasons.push("invoice date is not yyyy-mm-dd");
  }
  if (paymentDate !== null && !isDate(paymentDate)) {
    reasons.push("payment date is not yyyy-mm-dd");
  }
  if (declared === "INVOICED" && paymentDate !== null) {
    reasons.push("payment date conflicts with INVOICED status");
  }

  return {
    outcome: reasons.length ? "NEEDS_REVIEW" : declared,
    amount: Number.isFinite(amount) && amount >= 0 ? amount : 0,
    project,
    description,
    workDate,
    invoiceNumber,
    invoiceDate: invoiceDate && isDate(invoiceDate) ? invoiceDate : null,
    paymentDate: paymentDate && isDate(paymentDate) ? paymentDate : null,
    quantity: quantity !== null && quantity >= 0 ? quantity : 1,
    unitPrice: unitPrice !== null && unitPrice >= 0 ? unitPrice : null,
    type: VALID_TYPES.has(type) ? type : "OTHER",
    reasons,
  };
}

function normalizedInvoiceNumber(value) {
  return value ? value.toLowerCase() : null;
}

function rowFingerprint(record) {
  return [
    nullableText(record.project),
    nullableText(record.date),
    nullableText(record.description),
    nullableText(record.amount),
    nullableText(record.quantity) ?? "1",
    nullableText(record.unit_price),
    (nullableText(record.type) ?? "OTHER").toUpperCase(),
    (nullableText(record.status) ?? "").toUpperCase(),
    normalizedInvoiceNumber(nullableText(record.invoice_number)),
    nullableText(record.invoice_date),
    nullableText(record.payment_date),
  ]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .join("\u001f");
}

function addReason(result, reason) {
  if (!result.reasons.includes(reason)) result.reasons.push(reason);
  result.outcome = "NEEDS_REVIEW";
}

function markGroupConflict(group, reason) {
  for (const entry of group) addReason(entry.result, reason);
}

/**
 * A repeated invoice number is normal when it represents multiple line items.
 * Conflicting facts for that number, or an identical repeated row, are not.
 */
function applyDuplicateChecks(classified) {
  const byInvoice = new Map();
  const byRow = new Map();
  for (const entry of classified) {
    if (entry.result.outcome !== "NEEDS_REVIEW") {
      const invoiceKey = normalizedInvoiceNumber(entry.result.invoiceNumber);
      if (invoiceKey) {
        const group = byInvoice.get(invoiceKey) ?? [];
        group.push(entry);
        byInvoice.set(invoiceKey, group);
      }
      const rowKey = rowFingerprint(entry.record);
      const group = byRow.get(rowKey) ?? [];
      group.push(entry);
      byRow.set(rowKey, group);
    }
  }

  for (const group of byInvoice.values()) {
    const statuses = new Set(group.map((entry) => entry.result.outcome));
    const invoiceDates = new Set(
      group.map((entry) => entry.result.invoiceDate).filter(Boolean),
    );
    const paymentDates = new Set(
      group.map((entry) => entry.result.paymentDate).filter(Boolean),
    );
    if (statuses.size > 1) markGroupConflict(group, "invoice has conflicting billing facts");
    if (invoiceDates.size > 1) markGroupConflict(group, "invoice dates conflict");
    if (paymentDates.size > 1) markGroupConflict(group, "payment dates conflict");
  }
  for (const group of byRow.values()) {
    if (group.length > 1) markGroupConflict(group, "possible duplicate row");
  }
}

/* -------------------------------------------------------------- building */
function ensureCollections(db) {
  for (const key of ["projects", "billingItems", "invoices", "invoiceItems", "payments"]) {
    if (!Array.isArray(db[key])) db[key] = [];
  }
}

function createPayment(db, invoice, paymentDate, now, idFactory) {
  const existing = db.payments.find(
    (payment) => payment.invoiceId === invoice.id && !payment.voidedAt,
  );
  if (existing) {
    if (!existing.paidAt && paymentDate) existing.paidAt = paymentDate;
    existing.amount = invoice.amount;
    return existing;
  }
  const payment = {
    id: idFactory(),
    invoiceId: invoice.id,
    amount: invoice.amount,
    paidAt: paymentDate ?? null,
    slip: null,
    createdAt: now,
    createdBy: "Import",
    voidedAt: null,
    voidedBy: null,
  };
  db.payments.push(payment);
  return payment;
}

function mergeInvoiceMetadata(invoice, result) {
  if (invoice.invoiceDate == null && result.invoiceDate) invoice.invoiceDate = result.invoiceDate;
  if (invoice.status === "PAID" && invoice.paymentDate == null && result.paymentDate) {
    invoice.paymentDate = result.paymentDate;
  }
}

export function importHistory(
  db,
  records,
  clientName,
  { now = new Date().toISOString(), idFactory = randomUUID } = {},
) {
  ensureCollections(db);
  const client = db.clients.find(
    (candidate) => candidate.name.toLowerCase() === clientName.toLowerCase(),
  );
  if (!client) throw new Error(`Client "${clientName}" is not in the store. Add it first.`);

  const classified = records.map((record, index) => ({
    record,
    line: index + 2,
    result: classifyHistoryRecord(record),
  }));
  for (const entry of classified) {
    const rowClient = nullableText(entry.record.client);
    if (rowClient && rowClient.toLowerCase() !== clientName.toLowerCase()) {
      addReason(entry.result, `client does not match ${clientName}`);
    }
  }
  applyDuplicateChecks(classified);

  const problems = [];
  const projectsByName = new Map(
    db.projects
      .filter((project) => project.clientId === client.id)
      .map((project) => [project.name, project]),
  );
  const invoicesByNumber = new Map(
    db.invoices
      .filter((invoice) => invoice.status !== "VOID" && invoice.invoiceNumber)
      .map((invoice) => [invoice.invoiceNumber.toLowerCase(), invoice]),
  );
  const counts = { archived: 0, invoiced: 0, review: 0, projects: 0, invoices: 0 };

  for (const entry of classified) {
    const { record, line, result } = entry;
    if (result.reasons.length) problems.push(`line ${line}: ${result.reasons.join("; ")}`);

    let project = projectsByName.get(result.project);
    if (!project) {
      project = {
        id: idFactory(),
        clientId: client.id,
        name: result.project || record.project || "(unconfirmed)",
        date: result.workDate ?? now.slice(0, 10),
        createdAt: now,
        createdBy: "Import",
        updatedAt: now,
        updatedBy: "Import",
        deletedAt: null,
      };
      db.projects.push(project);
      projectsByName.set(project.name, project);
      counts.projects += 1;
    }

    const quantity = result.quantity;
    const unitPrice = result.unitPrice ?? result.amount / (quantity || 1);
    const delivered = result.outcome !== "NEEDS_REVIEW";
    const item = {
      id: idFactory(),
      projectId: project.id,
      description: result.description || "(unconfirmed)",
      type: result.type,
      quantity,
      unitPrice: Number.isFinite(unitPrice) ? Math.round(unitPrice * 100) / 100 : 0,
      amount: Math.round(result.amount * 100) / 100,
      customAmount: true,
      productionStatus: delivered ? "DELIVERED" : "IN_PROGRESS",
      billingStatus:
        result.outcome === "PAID"
          ? "PAID"
          : result.outcome === "INVOICED"
            ? "INVOICED"
            : "NEEDS_REVIEW",
      deliveredAt: delivered ? `${result.workDate}T00:00:00.000Z` : null,
      deliveredBy: delivered ? "Import" : null,
      invoiceId: null,
      note: nullableText(record.note) ?? undefined,
      createdAt: now,
      createdBy: "Import",
      updatedAt: now,
      updatedBy: "Import",
      deletedAt: null,
    };
    db.billingItems.push(item);

    if (result.outcome === "NEEDS_REVIEW") {
      counts.review += 1;
      continue;
    }

    let invoice = null;
    const invoiceKey = normalizedInvoiceNumber(result.invoiceNumber);
    if (invoiceKey) invoice = invoicesByNumber.get(invoiceKey) ?? null;
    if (!invoice) {
      invoice = {
        id: idFactory(),
        clientId: client.id,
        invoiceNumber: result.invoiceNumber,
        invoiceDate: result.invoiceDate,
        amount: 0,
        status: result.outcome === "PAID" ? "PAID" : "ISSUED",
        paymentDate: result.outcome === "PAID" ? result.paymentDate : null,
        paymentSlip: null,
        receiptStatus: result.outcome === "PAID" ? "RECEIVED" : "PENDING",
        createdAt: now,
        createdBy: "Import",
        updatedAt: now,
        updatedBy: "Import",
      };
      db.invoices.push(invoice);
      if (invoiceKey) invoicesByNumber.set(invoiceKey, invoice);
      counts.invoices += 1;
    } else {
      mergeInvoiceMetadata(invoice, result);
      if (result.outcome === "PAID" && invoice.status !== "PAID") {
        invoice.status = "PAID";
        invoice.receiptStatus = "RECEIVED";
      }
    }

    invoice.amount = Math.round((invoice.amount + item.amount) * 100) / 100;
    if (result.outcome === "PAID") createPayment(db, invoice, result.paymentDate, now, idFactory);
    const payment = db.payments.find(
      (candidate) => candidate.invoiceId === invoice.id && !candidate.voidedAt,
    );
    if (payment) payment.amount = invoice.amount;
    item.invoiceId = invoice.id;
    db.invoiceItems.push({ invoiceId: invoice.id, billingItemId: item.id });
    if (result.outcome === "PAID") counts.archived += 1;
    else counts.invoiced += 1;
  }

  return { counts, problems, classified };
}

/* ------------------------------------------------------- supabase output */
function sql(value) {
  if (value == null) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Generates executable SQL for the same imported rows, including links. */
export function buildSupabaseSql(db, clientName) {
  const importedItems = db.billingItems.filter((item) => item.createdBy === "Import");
  const importedItemIds = new Set(importedItems.map((item) => item.id));
  const links = db.invoiceItems.filter((link) => importedItemIds.has(link.billingItemId));
  const invoiceIds = new Set(links.map((link) => link.invoiceId));
  const importedInvoices = db.invoices.filter((invoice) => invoiceIds.has(invoice.id));
  const importedProjectIds = new Set(importedItems.map((item) => item.projectId));
  const importedProjects = db.projects.filter(
    (project) => project.createdBy === "Import" && importedProjectIds.has(project.id),
  );
  const projectsById = new Map(db.projects.map((project) => [project.id, project]));
  const importedPayments = db.payments.filter((payment) => invoiceIds.has(payment.invoiceId));
  const projectClient = `(select id from clients where lower(name) = lower(${sql(clientName)}))`;
  const projectReference = (projectId) => {
    const project = projectsById.get(projectId);
    if (!project || project.createdBy === "Import") return sql(projectId);

    // The local JSON repository uses stable slugs for seeded projects, while
    // Supabase uses UUIDs. Resolve an existing non-import project by its
    // client/name rather than sending that local slug to a uuid column.
    return `(select id from projects where client_id = ${projectClient} and lower(name) = lower(${sql(project.name)}) and created_by <> 'Import' order by date desc limit 1)`;
  };
  const lines = [
    "-- Generated by scripts/import-history.mjs. Review before running.",
    "-- null invoice_number/invoice_date/payment_date means the field was unknown;",
    "-- the imported billing or payment fact was still confirmed.",
    "begin;",
  ];

  for (const project of importedProjects) {
    lines.push(
      `insert into projects (id, client_id, name, date, created_at, created_by, updated_at, updated_by) values (${sql(project.id)}, ${projectClient}, ${sql(project.name)}, ${sql(project.date)}, ${sql(project.createdAt)}, 'Import', ${sql(project.updatedAt)}, 'Import') on conflict (id) do nothing;`,
    );
  }
  for (const invoice of importedInvoices) {
    lines.push(
      `insert into invoices (id, client_id, invoice_number, invoice_date, amount, status, payment_date, payment_slip, receipt_status, created_at, created_by, updated_at, updated_by) values (${sql(invoice.id)}, ${projectClient}, ${sql(invoice.invoiceNumber)}, ${sql(invoice.invoiceDate)}, ${sql(invoice.amount)}, ${sql(invoice.status)}, ${sql(invoice.paymentDate)}, ${sql(invoice.paymentSlip)}, ${sql(invoice.receiptStatus)}, ${sql(invoice.createdAt)}, 'Import', ${sql(invoice.updatedAt)}, 'Import') on conflict (id) do nothing;`,
    );
  }
  for (const item of importedItems) {
    lines.push(
      `insert into billing_items (id, project_id, description, type, quantity, unit_price, amount, custom_amount, production_status, billing_status, delivered_at, delivered_by, invoice_id, note, created_at, created_by, updated_at, updated_by) values (${sql(item.id)}, ${projectReference(item.projectId)}, ${sql(item.description)}, ${sql(item.type)}, ${sql(item.quantity)}, ${sql(item.unitPrice)}, ${sql(item.amount)}, true, ${sql(item.productionStatus)}, ${sql(item.billingStatus)}, ${sql(item.deliveredAt)}, ${sql(item.deliveredBy)}, ${sql(item.invoiceId)}, ${sql(item.note)}, ${sql(item.createdAt)}, 'Import', ${sql(item.updatedAt)}, 'Import') on conflict (id) do nothing;`,
    );
  }
  for (const link of links) {
    lines.push(
      `insert into invoice_items (invoice_id, billing_item_id) values (${sql(link.invoiceId)}, ${sql(link.billingItemId)}) on conflict do nothing;`,
    );
  }
  for (const payment of importedPayments) {
    lines.push(
      `insert into payments (id, invoice_id, amount, paid_at, slip, created_at, created_by, voided_at, voided_by) values (${sql(payment.id)}, ${sql(payment.invoiceId)}, ${sql(payment.amount)}, ${sql(payment.paidAt)}, ${sql(payment.slip)}, ${sql(payment.createdAt)}, 'Import', ${sql(payment.voidedAt)}, ${sql(payment.voidedBy)}) on conflict (id) do nothing;`,
    );
  }
  lines.push("commit;");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const [csvPath, clientName = "Ringer Hut"] = process.argv.slice(2);
  if (!csvPath) {
    console.error("Usage: npm run import:history -- <file.csv> [client name]");
    process.exitCode = 1;
    return;
  }

  const dataFile = process.env.CIJD_DATA_FILE ?? path.join(process.cwd(), ".data", "runtime", "db.json");
  const sqlOut = path.join(process.cwd(), "supabase", "import-history.sql");
  const records = recordsFromCsv(await readFile(csvPath, "utf8"));
  const db = JSON.parse(await readFile(dataFile, "utf8"));
  const { counts, problems } = importHistory(db, records, clientName);

  await mkdir(path.dirname(dataFile), { recursive: true });
  await writeFile(dataFile, JSON.stringify(db, null, 2), "utf8");
  await mkdir(path.dirname(sqlOut), { recursive: true });
  await writeFile(sqlOut, buildSupabaseSql(db, clientName), "utf8");

  console.log(`Imported ${records.length} rows into ${dataFile}`);
  console.log(
    `  archived (paid): ${counts.archived}\n  awaiting payment: ${counts.invoiced}\n  needs review: ${counts.review}\n  new projects: ${counts.projects}\n  invoices: ${counts.invoices}`,
  );
  if (problems.length) {
    console.log(`\nSent to NEEDS_REVIEW rather than guessed (${problems.length}):`);
    for (const problem of problems.slice(0, 30)) console.log(`  ${problem}`);
    if (problems.length > 30) console.log(`  ...and ${problems.length - 30} more`);
  }
  console.log(`\nSupabase statements written to ${sqlOut}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
