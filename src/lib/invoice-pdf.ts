import type { Locale } from "@/lib/i18n";
import { discountLabel } from "@/lib/billing-pricing";
import { money } from "@/lib/format";
import type { BillingDiscountType, BillingItem, Invoice, PltFormat } from "@/lib/types";

const PAGE_HEIGHT = 842;
const LEFT = 48;
const RIGHT = 547;

export interface InvoicePdfInput {
  invoice: Invoice;
  clientName?: string;
  items: BillingItem[];
  projectNames: Map<string, string>;
  locale: Locale;
}

/**
 * Generates a small, deterministic A4 invoice using only PDF's built-in
 * Helvetica fonts. Staff Note is intentionally not rendered here: this is the
 * customer-facing document boundary.
 */
export function createInvoicePdf(input: InvoicePdfInput): Uint8Array {
  const commands: string[] = ["q", "0 0 0 rg", "0.6 w"];
  const text = (font: "F1" | "F2", size: number, x: number, top: number, value: string) => {
    commands.push(`BT /${font} ${size} Tf ${x} ${PAGE_HEIGHT - top} Td (${escapePdf(value)}) Tj ET`);
  };
  const line = (top: number, x1 = LEFT, x2 = RIGHT) => {
    const y = PAGE_HEIGHT - top;
    commands.push(`${x1} ${y} m ${x2} ${y} l S`);
  };

  commands.push(`${LEFT} ${PAGE_HEIGHT - 39} ${RIGHT - LEFT} 2 re f`);
  text("F2", 11, LEFT, 29, "CIJD DESIGN");
  text("F2", 32, LEFT, 82, "INVOICE");
  text("F1", 9, 407, 66, `No. ${input.invoice.invoiceNumber ?? ""}`);
  text("F1", 9, 407, 82, formatDate(input.invoice.invoiceDate, input.locale));
  if (input.invoice.poNumber) text("F1", 9, 407, 98, `PO: ${clip(input.invoice.poNumber, 24)}`);
  line(123);

  text("F2", 11, LEFT, 151, clip(input.clientName ?? "", 55));
  let metaTop = 169;
  if (input.invoice.showParentCompany && input.invoice.parentCompanyName) {
    text("F1", 9, LEFT, metaTop, `Parent Company: ${clip(input.invoice.parentCompanyName, 55)}`);
    metaTop += 14;
  }
  text("F1", 8, LEFT, metaTop, `PLT Format: ${pltLabel(input.invoice.pltFormat)}`);
  const vatText = input.invoice.noVat
    ? "VAT: No VAT"
    : input.invoice.stateChargeVat
      ? "VAT: State Charge VAT"
      : "VAT: Standard / unchanged";
  text("F1", 8, 250, metaTop, vatText);

  const headerTop = 216;
  text("F2", 8, LEFT, headerTop, "DESCRIPTION / ORIGINAL NAME");
  text("F2", 8, 337, headerTop, "UNIT");
  text("F2", 8, 393, headerTop, "QTY");
  text("F2", 8, 425, headerTop, "DISCOUNT");
  text("F2", 8, 493, headerTop, "SUB TOTAL");
  line(227);

  const groups = new Map<string, BillingItem[]>();
  for (const item of input.items) {
    const project = input.projectNames.get(item.projectId) ?? "";
    const list = groups.get(project);
    if (list) list.push(item);
    else groups.set(project, [item]);
  }

  let top = 248;
  let shownRows = 0;
  for (const [project, items] of groups) {
    if (top > 660) break;
    if (project) {
      text("F2", 9, LEFT, top, clip(project, 48));
      top += 15;
    }
    for (const item of items) {
      if (top > 680) break;
      text("F1", 9, LEFT + 8, top, clip(item.description, 43));
      text("F1", 9, 337, top, money(item.unitPrice));
      text("F1", 9, 393, top, formatNumber(item.quantity));
      text(
        "F1",
        8,
        425,
        top,
        discountLabel((item.discountType ?? "NONE") as BillingDiscountType, item.discountValue ?? 0),
      );
      text("F1", 9, 493, top, money(item.amount));
      top += 13;
      const original = item.originalName?.trim();
      if (original) {
        text("F1", 7.5, LEFT + 8, top, `Original: ${clip(original, 52)}`);
        top += 13;
      }
      shownRows += 1;
    }
    line(top - 4);
    top += 10;
  }
  if (shownRows < input.items.length) text("F1", 8, LEFT + 8, 696, "Additional items omitted");

  let footerTop = Math.min(Math.max(top + 6, 704), 726);
  if (input.invoice.customerNote) {
    text("F2", 8, LEFT, footerTop, "CUSTOMER NOTE");
    footerTop += 12;
    text("F1", 8, LEFT, footerTop, clip(input.invoice.customerNote.replace(/[\r\n]+/g, " "), 86));
    footerTop += 16;
  }

  const totalTop = Math.min(Math.max(footerTop + 10, 748), 774);
  line(totalTop - 16);
  text("F2", 12, LEFT, totalTop, "TOTAL");
  text("F2", 16, 485, totalTop, money(input.invoice.amount));
  commands.push("Q");

  return buildPdf(commands.join("\n"));
}

export function downloadInvoicePdf(input: InvoicePdfInput): void {
  const url = URL.createObjectURL(invoicePdfBlob(input));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName(input.invoice);
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function openInvoicePdf(input: InvoicePdfInput): void {
  const url = URL.createObjectURL(invoicePdfBlob(input));
  const popup = window.open(url, "_blank", "noopener,noreferrer");
  if (!popup) downloadInvoicePdf(input);
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function invoicePdfBlob(input: InvoicePdfInput): Blob {
  const source = createInvoicePdf(input);
  const buffer = new ArrayBuffer(source.byteLength);
  new Uint8Array(buffer).set(source);
  return new Blob([buffer], { type: "application/pdf" });
}

function formatDate(date: string | null, locale: Locale): string {
  if (!date) return "";
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return date;
  if (locale === "ja") return `${year}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(year, month - 1, day));
}

function pltLabel(value?: PltFormat): string {
  if (value === "IMPORT_PRODUCT") return "Import Product";
  if (value === "DISTRIBUTOR") return "Distributor";
  return "Normal";
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value).replace(/\.0+$/, "");
}

function clip(value: string, max: number): string {
  const clean = value.replace(/[\r\n]+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, Math.max(0, max - 3))}...` : clean;
}

function fileName(invoice: Invoice): string {
  const base = invoice.invoiceNumber?.trim() || "invoice";
  return `${base.replace(/[^a-z0-9_-]+/gi, "-")}.pdf`;
}

function escapePdf(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/([\\()])/g, "\\$1")
    .replace(/[\r\n]/g, " ");
}

function buildPdf(content: string): Uint8Array {
  const encoder = new TextEncoder();
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];

  let output = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(encoder.encode(output).length);
    output += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = encoder.encode(output).length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    output += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return encoder.encode(output);
}
