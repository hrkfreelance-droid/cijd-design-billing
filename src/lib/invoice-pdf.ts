import type { Locale } from "@/lib/i18n";
import { money } from "@/lib/format";
import type { BillingItem, Invoice } from "@/lib/types";
import type { V4Invoice } from "@/lib/v4/types";

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
 * Helvetica fonts. That keeps the same PDF available in Preview and in the
 * Supabase-backed app without adding a server-only PDF dependency.
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
  text("F1", 9, 420, 70, `No. ${input.invoice.invoiceNumber ?? ""}`);
  text("F1", 9, 420, 88, formatDate(input.invoice.invoiceDate, input.locale));
  line(123);

  text("F2", 11, LEFT, 154, input.clientName ?? "");
  text("F2", 9, LEFT, 216, "DESCRIPTION");
  text("F2", 9, 407, 216, "QTY");
  text("F2", 9, 469, 216, "AMOUNT");
  line(227);

  const groups = new Map<string, BillingItem[]>();
  for (const item of input.items) {
    const project = input.projectNames.get(item.projectId) ?? "";
    const list = groups.get(project);
    if (list) list.push(item);
    else groups.set(project, [item]);
  }

  let top = 252;
  let shownRows = 0;
  for (const [project, items] of groups) {
    if (top > 690) break;
    text("F2", 10, LEFT, top, project);
    top += 17;
    for (const item of items) {
      if (top > 710) break;
      text("F1", 10, LEFT + 10, top, item.description);
      text("F1", 10, 407, top, String(item.quantity));
      text("F1", 10, 469, top, money(item.amount));
      top += 20;
      shownRows += 1;
    }
    line(top - 7);
    top += 12;
  }
  if (shownRows < input.items.length) text("F1", 9, LEFT + 10, 704, "Additional items omitted");

  const totalTop = Math.min(Math.max(top + 10, 742), 760);
  line(totalTop - 16);
  text("F2", 12, LEFT, totalTop, "TOTAL");
  text("F2", 16, 469, totalTop, money(input.invoice.amount));
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

/** Opens the V4 Excel-aligned bilingual A4 invoice in a print/PDF-ready tab. */
export function openV4TaxInvoicePrint(invoice: V4Invoice): void {
  const popup = window.open("", "_blank", "noopener,noreferrer");
  if (!popup) return;
  const rows = invoice.lines.map((line) => `<tr><td>${escapeHtml(line.description)}</td><td>${escapeHtml(line.quantity)}</td><td>${escapeHtml(line.unitPrice)}</td><td>${escapeHtml(lineAmountText(line.quantity, line.unitPrice))}</td></tr>`).join("");
  popup.document.write(`<!doctype html><html lang="km"><head><meta charset="utf-8"><title>${escapeHtml(invoice.invoiceNumber ?? "Tax Invoice")}</title><style>@page{size:A4;margin:14mm}body{font-family:Arial,"Noto Sans Khmer",sans-serif;color:#111;margin:0}header{border-bottom:3px solid #111;padding-bottom:14px;display:flex;justify-content:space-between}h1{font-size:28px;margin:0 0 4px}h2{font-size:18px;margin:0 0 4px}p{margin:4px 0;font-size:12px}.meta{text-align:right}table{width:100%;border-collapse:collapse;margin-top:28px;font-size:12px}th,td{border-bottom:1px solid #bbb;padding:8px;text-align:left}th:nth-child(n+2),td:nth-child(n+2){text-align:right}.totals{margin:22px 0 0 auto;width:260px;font-size:13px}.totals div{display:flex;justify-content:space-between;padding:4px 0}.grand{border-top:2px solid #111;font-size:17px;font-weight:700;margin-top:5px;padding-top:8px}.actions{margin-top:28px}@media print{.actions{display:none}}</style></head><body><header><div><h2>CIJD CO., LTD.</h2><p>ស៊ីអាយជេឌី ឯ.ក</p><h1>TAX INVOICE</h1><p>វិក្កយបត្រអាករ</p></div><div class="meta"><p><strong>No. ${escapeHtml(invoice.invoiceNumber ?? "Draft")}</strong></p><p>${escapeHtml(invoice.invoiceDate)}</p><p>${escapeHtml(invoice.status)}</p></div></header><section style="margin-top:18px"><p><strong>Customer / អតិថិជន:</strong> ${escapeHtml(invoice.customerName)}</p><p>${escapeHtml(invoice.customerKhmerName ?? "")}</p><p>${escapeHtml(invoice.customerAddress ?? "")}</p><p>${escapeHtml(invoice.customerPhone ?? "")}${invoice.customerVatin ? ` · VATIN ${escapeHtml(invoice.customerVatin)}` : ""}</p></section><table><thead><tr><th>Description / បរិយាយ</th><th>Quantity / បរិមាណ</th><th>Unit Price / តម្លៃឯកតា (USD)</th><th>Amount / ចំនួនទឹកប្រាក់ (USD)</th></tr></thead><tbody>${rows}</tbody></table><div class="totals"><div><span>Subtotal</span><span>$${escapeHtml(invoice.subtotal)}</span></div><div><span>VAT 10%</span><span>$${escapeHtml(invoice.vatAmount)}</span></div><div class="grand"><span>USD Total</span><span>$${escapeHtml(invoice.usdTotal)}</span></div>${invoice.exchangeRate && invoice.khrTotal ? `<div><span>Exchange Rate</span><span>${escapeHtml(invoice.exchangeRate)} KHR/USD</span></div><div><span>KHR Total</span><span>៛${escapeHtml(invoice.khrTotal)}</span></div>` : ""}</div><div class="actions"><button onclick="window.print()">Print / Save PDF</button></div><script>window.onload=()=>setTimeout(()=>window.print(),250)</script></body></html>`);
  popup.document.close();
  popup.focus();
}

function lineAmountText(quantity: string, unitPrice: string): string {
  const amount = Number(quantity) * Number(unitPrice);
  return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
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
