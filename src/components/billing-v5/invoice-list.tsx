"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Input, Select } from "@/components/ui";
import { useV5T, type V5Key } from "@/lib/billing-v5/i18n";
import { invoiceCollection } from "@/lib/billing-v5/ontology";
import { moneyExact } from "@/lib/format";
import type { Snapshot } from "@/lib/types";

type Status = "ALL" | "UNPAID" | "PARTIALLY_PAID" | "PAID" | "CANCELLED";

/**
 * Every invoice with what it has collected. Search by number, customer or
 * amount; filter by year and collection status. A row opens the invoice.
 */
export function InvoiceList({ snapshot, compact = false }: { snapshot: Snapshot; compact?: boolean }) {
  const t = useV5T();
  const [query, setQuery] = useState("");
  const [year, setYear] = useState("ALL");
  const [status, setStatus] = useState<Status>("ALL");

  const rows = useMemo(
    () =>
      (snapshot.taxInvoices ?? [])
        .map((invoice) => {
          const money = invoiceCollection(snapshot, invoice);
          const customer = snapshot.clients.find((c) => c.id === invoice.clientId)?.name ?? invoice.customer.companyNameEn;
          return { invoice, money, customer, status: (invoice.status === "CANCELLED" ? "CANCELLED" : money.status) as Exclude<Status, "ALL"> };
        })
        .sort((a, b) => b.invoice.invoiceDate.localeCompare(a.invoice.invoiceDate) || b.invoice.invoiceNumber.localeCompare(a.invoice.invoiceNumber)),
    [snapshot],
  );
  const years = [...new Set(rows.map((row) => row.invoice.invoiceDate.slice(0, 4)))].sort().reverse();
  const needle = query.trim().toLowerCase();
  const shown = rows.filter((row) => {
    if (year !== "ALL" && !row.invoice.invoiceDate.startsWith(year)) return false;
    if (status !== "ALL" && row.status !== status) return false;
    if (!needle) return true;
    return [row.invoice.invoiceNumber, row.customer, row.invoice.customer.companyNameEn, row.invoice.project.name, row.invoice.invoiceDate, row.invoice.totalUsd.toFixed(2)]
      .some((value) => value.toLowerCase().includes(needle));
  });

  return (
    <section className={compact ? "pt-10" : "pt-8"} data-testid="v5-section-issued">
      {compact ? (
        <h2 className="pb-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">
          {t("accounting.issued")}
          <span className="tnum ml-2 font-normal text-faint">{rows.length}</span>
        </h2>
      ) : (
        <div className="grid gap-2 pb-4 sm:grid-cols-[minmax(0,1fr)_9rem_11rem]">
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("list.search")} aria-label={t("list.search")} data-testid="v5-invoice-search" />
          <Select value={year} onChange={(event) => setYear(event.target.value)} aria-label={t("list.date")} data-testid="v5-invoice-year">
            <option value="ALL">{t("list.allYears")}</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </Select>
          <Select value={status} onChange={(event) => setStatus(event.target.value as Status)} aria-label={t("list.status")} data-testid="v5-invoice-status-filter">
            <option value="ALL">{t("list.allStatus")}</option>
            {(["UNPAID", "PARTIALLY_PAID", "PAID", "CANCELLED"] as const).map((s) => <option key={s} value={s}>{t(`status.${s}` as V5Key)}</option>)}
          </Select>
        </div>
      )}
      {shown.length === 0 ? (
        <p className="border-t border-line py-6 text-[13.5px] text-muted">{rows.length ? t("list.empty") : t("accounting.issuedEmpty")}</p>
      ) : (
        <ul className="border-t border-line-strong">
          <li className="hidden grid-cols-[8.5rem_6rem_minmax(0,1fr)_6.5rem_6.5rem_6.5rem_7rem] gap-x-3 border-b border-line py-2 text-[11px] font-medium uppercase tracking-[0.06em] text-faint md:grid">
            <span>{t("list.number")}</span>
            <span>{t("list.date")}</span>
            <span>{t("list.customer")}</span>
            <span className="text-right">{t("list.total")}</span>
            <span className="text-right">{t("list.paid")}</span>
            <span className="text-right">{t("list.outstanding")}</span>
            <span className="text-right">{t("list.status")}</span>
          </li>
          {shown.map(({ invoice, money, customer, status: rowStatus }) => {
            const cancelled = rowStatus === "CANCELLED";
            return (
              <li key={invoice.id} className="border-b border-line">
                <Link
                  href={`/office-v5/tax-invoices/${invoice.id}`}
                  aria-label={t("invoice.open", { number: invoice.invoiceNumber })}
                  className="group grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 py-3 md:grid-cols-[8.5rem_6rem_minmax(0,1fr)_6.5rem_6.5rem_6.5rem_7rem] md:items-baseline"
                  data-testid="v5-issued-row"
                >
                  <span className="tnum text-[14px] font-medium group-hover:underline group-hover:underline-offset-4">{invoice.invoiceNumber}</span>
                  <span className={`tnum text-right text-[14px] font-semibold md:hidden ${cancelled ? "text-faint line-through" : ""}`}>{moneyExact(invoice.totalUsd)}</span>
                  <span className="tnum hidden text-[13px] text-muted md:block">{invoice.invoiceDate}</span>
                  <span className="min-w-0 truncate text-[13px] text-muted">
                    <span className="md:hidden">{invoice.invoiceDate} · </span>
                    {customer}
                    {invoice.project.name && <span className="text-faint"> · {invoice.project.name}</span>}
                  </span>
                  <span className={`tnum hidden text-right text-[14px] font-semibold md:block ${cancelled ? "text-faint line-through" : ""}`}>{moneyExact(invoice.totalUsd)}</span>
                  <span className="tnum hidden text-right text-[13px] text-muted md:block">{cancelled ? "—" : moneyExact(money.paidUsd)}</span>
                  <span className="tnum hidden text-right text-[13px] md:block" data-testid="v5-row-outstanding">{cancelled ? "—" : moneyExact(money.outstandingUsd)}</span>
                  <span
                    className={`text-right text-[12.5px] ${cancelled ? "text-danger" : rowStatus === "PAID" ? "text-paid" : rowStatus === "PARTIALLY_PAID" ? "text-pending" : "text-muted"}`}
                    data-testid="v5-row-status"
                  >
                    {t(`status.${rowStatus}` as V5Key)}
                    {!cancelled && rowStatus !== "PAID" && <span className="tnum md:hidden"> · {moneyExact(money.outstandingUsd)}</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
