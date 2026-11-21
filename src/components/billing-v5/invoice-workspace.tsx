"use client";

import { useRef, useState, type CSSProperties } from "react";
import { useI18n } from "@/components/providers";
import { useV5T, type V5Key } from "@/lib/billing-v5/i18n";
import { invoiceCollection } from "@/lib/billing-v5/ontology";
import { moneyExact } from "@/lib/format";
import type { Snapshot, TaxInvoiceRecord } from "@/lib/types";
import { InvoiceDetailPanel, InvoiceStatus, useInvoiceSheet } from "./invoice-detail-panel";

export function invoiceSubject(invoice: TaxInvoiceRecord) {
  const names = [...new Set(invoice.lines.map((line) => line.projectName?.trim()).filter(Boolean))];
  return names.join(" / ") || invoice.project.name || "—";
}

/** Shared compact table and selected invoice. Scroll belongs to the table,
 * never to the page; narrow viewports use the canonical mobile drawer.
 */
export function InvoiceWorkspace({ snapshot, invoices, accounting = false, groupByCustomer = false }: {
  snapshot: Snapshot; invoices: TaxInvoiceRecord[]; accounting?: boolean; groupByCustomer?: boolean;
}) {
  const t = useV5T();
  const { locale } = useI18n();
  const [selected, setSelected] = useState<string | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const sheet = useInvoiceSheet();
  const current = invoices.find((invoice) => invoice.id === selected);
  const customerName = (invoice: TaxInvoiceRecord) => snapshot.clients.find((client) => client.id === invoice.clientId)?.name ?? invoice.customer.companyNameEn;
  const groups = groupByCustomer
    ? [...new Set(invoices.map((invoice) => invoice.clientId))].map((id) => ({ id, invoices: invoices.filter((invoice) => invoice.clientId === id) }))
    : [{ id: "all", invoices }];
  const usdWidth = Math.max(12, ...invoices.flatMap((invoice) => {
    const money = invoiceCollection(snapshot, invoice);
    return [invoice.totalUsd, money.paidUsd, money.outstandingUsd].map((value) => moneyExact(value).length);
  })) * 8 + 24;
  const khrWidth = Math.max(12, ...invoices.map((invoice) => (invoice.totalKhr?.toLocaleString("en-US") ?? "—").length)) * 8 + 24;
  const style = { "--iv-usd-width": `${usdWidth}px`, "--iv-khr-width": `${khrWidth}px`,
    "--iv-table-width": `${accounting ? 600 + usdWidth * 3 : 800 + usdWidth + khrWidth}px` } as CSSProperties;
  const close = () => { setSelected(null); requestAnimationFrame(() => opener.current?.focus()); };

  return <div className="iv-split" data-open={!!current} data-testid="v5-invoice-workspace">
    <div className="iv-table-scroll" tabIndex={0} role="region" aria-label={t("view.invoices")} style={style}>
      <table className={`iv-table ${accounting ? "iv-table-accounting" : ""}`}>
        <colgroup><col className="iv-col-number" /><col className="iv-col-date" /><col className="iv-col-customer" /><col />
          <col className="iv-col-usd" /><col className={accounting ? "iv-col-usd" : "iv-col-khr"} /><col className={accounting ? "iv-col-usd" : "iv-col-status"} /></colgroup>
        <thead><tr>
          <th scope="col">{t("list.number")}</th><th scope="col">{t("list.date")}</th><th scope="col">{t("list.customer")}</th>
          <th scope="col">{locale === "ja" ? "件名" : locale === "kh" ? "ប្រធានបទ" : "Subject"}</th>
          <th scope="col" className="iv-number">{accounting ? t("list.total") : "USD"}</th>
          <th scope="col" className="iv-number">{accounting ? t("list.paid") : "KHR"}</th>
          <th scope="col" className={accounting ? "iv-number" : ""}>{t(accounting ? "list.outstanding" : "list.status")}</th>
        </tr></thead>
        {groups.map((group) => <tbody key={group.id} data-testid={accounting ? "v5-issued-client-group" : undefined}>
          {groupByCustomer && <tr className="iv-group"><th colSpan={4} scope="rowgroup">{customerName(group.invoices[0])}</th><td colSpan={3} className="iv-number">{moneyExact(group.invoices.reduce((sum, invoice) => sum + invoiceCollection(snapshot, invoice).outstandingUsd, 0))}</td></tr>}
          {group.invoices.map((invoice) => {
            const money = invoiceCollection(snapshot, invoice);
            const cancelled = invoice.status === "CANCELLED";
            const status = cancelled ? "CANCELLED" : money.status;
            const customer = customerName(invoice);
            const subject = invoiceSubject(invoice);
            return <tr key={invoice.id} data-selected={current?.id === invoice.id} data-cancelled={cancelled} data-testid="v5-issued-row" onClick={(event) => {
              opener.current = event.currentTarget.querySelector("button");
              setSelected(invoice.id);
            }}>
              <td><div className="iv-invoice-number"><button type="button" aria-label={t("invoice.open", { number: invoice.invoiceNumber })} aria-expanded={current?.id === invoice.id} title={invoice.invoiceNumber} onClick={(event) => {
                opener.current = event.currentTarget;
                setSelected(invoice.id);
              }}><span className="iv-ellipsis tnum">{invoice.invoiceNumber}</span></button>
                {!accounting && <span className="iv-kind" title={t(`list.kind.${invoice.invoiceKind ?? "FULL"}` as V5Key)}>{invoice.invoiceKind?.startsWith("DEPOSIT") ? "DEPOSIT" : invoice.invoiceKind ?? "FULL"}</span>}
                {accounting && <span className="iv-dot" data-status={status} role="img" aria-label={t(`status.${status}` as V5Key)} />}
              </div></td>
              <td className="tnum iv-date">{invoice.invoiceDate}</td>
              <td><span className="iv-ellipsis" title={customer}>{customer}</span></td>
              <td><span className="iv-ellipsis" title={subject}>{subject}</span></td>
              <td className="iv-number iv-total">{moneyExact(invoice.totalUsd)}</td>
              <td className="iv-number">{accounting ? moneyExact(money.paidUsd) : invoice.totalKhr?.toLocaleString("en-US") ?? "—"}</td>
              <td className={accounting ? "iv-number" : ""} data-testid={accounting ? "v5-row-outstanding" : undefined}>
                {accounting ? moneyExact(money.outstandingUsd) : <InvoiceStatus status={status} />}
              </td>
            </tr>;
          })}
        </tbody>)}
      </table>
    </div>
    {current && <InvoiceDetailPanel key={`${current.id}:${current.revision ?? 1}`} invoice={current} snapshot={snapshot} onClose={close} sheet={sheet} />}
  </div>;
}
