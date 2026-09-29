import Image from "next/image";

import type { TaxInvoiceRecord } from "@/lib/types";

/**
 * The CIJD Tax Invoice (template: V4's InvoiceDocument, workbook sheet
 * CIJDTI2026080). Text, layout and bank details are V4's, unchanged. It
 * renders only from the frozen invoice record, never from live project data.
 */
export type InvoiceView = Omit<TaxInvoiceRecord, "id" | "ledgerInvoiceId" | "issuedAt" | "issuedBy"> & {
  /** Preview before issue: no number yet is shown as DRAFT. */
  draft?: boolean;
};

const usd = (value: number) => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const khr = (value: number | null) => (value == null ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: 0 }));

function dateText(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" })
    .format(date)
    .replaceAll(" ", "-");
}

function khmerDigits(value: number) {
  return String(value).replace(/\d/g, (digit) => "០១២៣៤៥៦៧៨៩"[Number(digit)]);
}

function khmerDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  const months = ["មករា", "កុម្ភៈ", "មីនា", "មេសា", "ឧសភា", "មិថុនា", "កក្កដា", "សីហា", "កញ្ញា", "តុលា", "វិច្ឆិកា", "ធ្នូ"];
  return `${khmerDigits(date.getUTCDate())}-${months[date.getUTCMonth()]}-${khmerDigits(date.getUTCFullYear())}`;
}

function Accounting({ value, blank = false }: { value?: number; blank?: boolean }) {
  return (
    <span className="accounting">
      <i>$</i>
      <b>{blank ? "-" : usd(value ?? 0)}</b>
    </span>
  );
}

export const INVOICE_ROWS = 10;

export function InvoiceDocument({ invoice }: { invoice: InvoiceView }) {
  const rows = [
    ...invoice.lines,
    ...Array.from({ length: Math.max(0, INVOICE_ROWS - invoice.lines.length) }, () => null),
  ].slice(0, INVOICE_ROWS);
  const customer = invoice.customer;
  return (
    <div className="v5-invoice">
      <article className="invoice-sheet" data-testid="tax-invoice-sheet">
        <header className="invoice-company">
          <div className="company-name">
            <Image src="/assets/cijd-logo.jpg" alt="CIJD" width={339} height={63} priority unoptimized />
          </div>
          <div className="company-title khmer">
            <strong>ស៊ីអាយជេឌី ឯ.ក</strong>
            <span>CIJD CO., LTD.</span>
          </div>
          <div className="company-address khmer">
            <p>លេខអត្តសញ្ញាណកម្ម អតប (VATIN) K002-901900787</p>
            <p>អាស័យដ្ឋាន៖ ផ្ទះលេខ ១A ផ្លូវ៥៧ ភូមិ៤ សង្កាត់បឹងកេងកងទី១ ខណ្ឌបឹងកេងកង រាជធានីភ្នំពេញ</p>
            <p>Address: #1A, Street 57, Phum 4, Sangkat Beoung Keng Kang 1, Khan Beoung Keng Kang, Phnom Penh.</p>
            <p>Telephone No. (+855) 96 888 3388</p>
          </div>
        </header>

        <div className="invoice-title khmer">
          <strong>វិក្កយបត្រអាករ</strong>
          <span>TAX INVOICE</span>
        </div>

        <section className="invoice-parties">
          <div className="customer-block khmer" data-testid="tax-invoice-customer">
            <p><b>អតិថិជន / Customer៖</b></p>
            <p>ឈ្មោះក្រុមហ៊ុន ឬអតិថិជន៖ {customer.companyNameKm}</p>
            <p>Company Name / Customer៖ {customer.companyNameEn}</p>
            <p>អាស័យដ្ឋាន៖ {customer.addressKm}</p>
            <p>Address: {customer.addressEn}</p>
            <p>ទូរស័ព្ទលេខ៖ {customer.telephone}</p>
            <p>Telephone No. {customer.telephone}</p>
            <p>លេខអត្តសញ្ញាណកម្ម អតប (VATIN) {customer.vatin}</p>
          </div>
          <div className="invoice-meta khmer">
            <p>លេខរៀងវិក្កយបត្រ៖</p>
            <p>
              Invoice No. <b data-testid="tax-invoice-number">{invoice.draft ? "DRAFT" : invoice.invoiceNumber}</b>
            </p>
            <p>កាលបរិច្ឆេទ៖ {khmerDate(invoice.invoiceDate)}</p>
            <p>Date៖ {dateText(invoice.invoiceDate)}</p>
            <label>
              Exchange Rate <b data-testid="tax-invoice-rate">{invoice.exchangeRate.toLocaleString("en-US")}</b>
            </label>
          </div>
        </section>

        {invoice.status === "CANCELLED" && <div className="cancelled-watermark">CANCELLED</div>}
        {invoice.draft && <div className="draft-watermark">DRAFT</div>}

        <table className="invoice-lines" data-testid="tax-invoice-lines">
          <colgroup>
            <col className="col-no" />
            <col className="col-description" />
            <col className="col-number" />
            <col className="col-number" />
            <col className="col-number" />
          </colgroup>
          <thead>
            <tr className="khmer">
              <th>ល.រ</th>
              <th>បរិយាយមុខទំនិញ</th>
              <th>បរិមាណ</th>
              <th>ថ្លៃឯកតា</th>
              <th>ថ្លៃទំនិញ</th>
            </tr>
            <tr>
              <th>No.</th>
              <th>Description</th>
              <th>quantity</th>
              <th>Unit Price</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((line, index) => (
              <tr key={line ? `${line.billingItemId}-${index}` : `empty-${index}`} data-testid={line ? "tax-invoice-line" : undefined}>
                <td>{line ? index + 1 : ""}</td>
                <td>{line?.description ?? ""}</td>
                <td>{line ? line.quantity : ""}</td>
                <td><Accounting value={line?.unitPrice} blank={!line} /></td>
                <td><Accounting value={line?.amount} blank={!line} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={4}><span className="khmer">សរុប</span><small>Sub Total</small></th>
              <td data-testid="tax-invoice-subtotal"><Accounting value={invoice.subtotalUsd} /></td>
            </tr>
            <tr>
              <th colSpan={4}>
                <span className="khmer">អាករលើតម្លៃបន្ថែម {khmerDigits(invoice.vatPercent)}%</span>
                <small>VAT ({invoice.vatPercent}%)</small>
              </th>
              <td data-testid="tax-invoice-vat"><Accounting value={invoice.vatUsd} /></td>
            </tr>
            <tr>
              <th colSpan={4}><span className="khmer">សរុបរួមជាដុល្លារ</span><small>Grand Total in USD</small></th>
              <td data-testid="tax-invoice-total-usd"><Accounting value={invoice.totalUsd} /></td>
            </tr>
            <tr>
              <th colSpan={4}><span className="khmer">សរុបរួមជារៀល</span><small>Grand Total in Riel</small></th>
              <td data-testid="tax-invoice-total-khr">{khr(invoice.totalKhr)}</td>
            </tr>
          </tfoot>
        </table>

        <section className="bank-accounts">
          <div>
            <b>◯Bank account info</b>
            <p>Bank name : ACLEDA Bank Plc.</p>
            <p>Branch name : Beoung Trabek Branch</p>
            <p>Beneficiary : CIJD Co., LTD</p>
            <p>Account No : 29000314877717</p>
          </div>
          <div>
            <p>Bank name : ABA bank</p>
            <p>ABA Swift Code : ABAAKHPP</p>
            <p>Branch name : Mao Tse Thoung Branch</p>
            <p>Beneficiary : CIJD Co., Ltd.</p>
            <p>Account No : 000967072</p>
          </div>
        </section>

        <footer className="invoice-signatures khmer">
          <div><b>ហត្ថលេខា និងឈ្មោះអ្នកទិញ</b><span>Customer&apos;s Signature &amp; Name</span></div>
          <div><b>ហត្ថលេខា និងឈ្មោះអ្នកលក់</b><span>Seller&apos;s Signature &amp; Name</span></div>
        </footer>
      </article>
    </div>
  );
}
