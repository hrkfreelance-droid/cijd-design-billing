import { fixture } from "./v3-rows.ts";

export const archiveName = "Archive Brochure — សៀវភៅផ្សព្វផ្សាយសម្រាប់សាកល្បងកំណត់ត្រា";
export const archiveItem = "BrochurePrintRunWithAnIntentionallyLongUnbrokenProductNameＡＢＣＤＥＦＧ東南アジアでの印刷";
export const archiveId = "p-billed";

export function workspaceFixture() {
  const rows = fixture();
  rows.clients[0].name = "Example Studio";
  const base = rows.projects[2];
  rows.projects[2] = { ...base, name: archiveName };
  rows.projects.push({ ...base, id: "p-older-billed", name: "Archive Brochure earlier edition", date: "2026-08-01" });
  rows.billing_items[4] = {
    ...rows.billing_items[4], description: archiveItem, type: "PRINT", service_type: "PRINTING", quantity: "123456789",
    amount: "123456789.00", unit_price: "1.00", print_cost: "120000000.00", created_by: "import",
  };
  rows.billing_items.push({
    ...rows.billing_items[4], id: "l-older-billed", project_id: "p-older-billed", quantity: "200",
    unit_price: "1.50", amount: "300.00", print_cost: "150.00", invoice_id: null, description: archiveItem.normalize("NFKC"),
  });
  rows.billing_items.push({
    ...rows.billing_items[4], id: "l-billed-design", type: "DESIGN", service_type: "DESIGN", description: "Brochure artwork",
    quantity: "1", unit_price: "180", amount: "180", print_cost: null,
  });
  for (const row of [...rows.projects, ...rows.billing_items]) {
    if (row.created_by !== "import") row.created_by = "Example designer";
    row.updated_by = "Example designer";
    if ("delivered_by" in row) row.delivered_by = "Example designer";
  }
  rows.invoices[0].invoice_number = "EXAMPLE-ARCHIVE-01";
  return rows;
}

if (process.argv[1]?.endsWith("/tests/fixtures/v5-workspace-history.ts")) process.stdout.write(JSON.stringify(workspaceFixture()));
