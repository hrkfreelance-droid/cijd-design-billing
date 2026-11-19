"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Input, Select } from "@/components/ui";
import { useV5T, type V5Key } from "@/lib/billing-v5/i18n";
import { invoiceCollection } from "@/lib/billing-v5/ontology";
import { phnomPenhDate } from "@/lib/exchange-rate";
import { normalizeSearch, matchesSearch } from "@/lib/billing-v5/project-view";
import { Amount, WorkspaceState } from "./workspace-parts";
import { moneyExact } from "@/lib/format";
import type { Snapshot } from "@/lib/types";

type Status = "ALL" | "UNPAID" | "PARTIALLY_PAID" | "PAID" | "CANCELLED";

/**
 * Every invoice with what it has collected. Search by number, customer or
 * amount; filter by year and collection status. A row opens the invoice.
 */
export function InvoiceList({ snapshot, collectionFilter }: { snapshot: Snapshot; collectionFilter?: string | null }) {
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
  const needle = query.trim();
  const today = phnomPenhDate();
  const shown = rows.filter((row) => {
    if (collectionFilter === "paid" && row.status !== "PAID") return false;
    if ((collectionFilter === "open" || collectionFilter === "overdue") &&
        (row.invoice.status !== "ISSUED" || row.money.outstandingUsd <= 0)) return false;
    if (collectionFilter === "overdue" && (!row.invoice.dueDate || row.invoice.dueDate >= today)) return false;
    if (year !== "ALL" && !row.invoice.invoiceDate.startsWith(year)) return false;
    if (status !== "ALL" && row.status !== status) return false;
    if (!needle) return true;
    return matchesSearch(normalizeSearch([row.invoice.invoiceNumber, row.invoice.invoiceKind ?? "FULL", row.customer,
      row.invoice.customer.companyNameEn, row.invoice.customer.companyNameKm, row.invoice.project.name,
      ...row.invoice.lines.map((line) => line.description), row.invoice.invoiceDate, row.invoice.totalUsd.toFixed(2),
    ].join(" ")), needle);
  });

  return (
    <section className="bw-invoice-list" data-testid="v5-section-issued">
      <div className="bw-filter-panel mb-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_11rem]" data-layout-group>
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
      {shown.length === 0 ? (
        <WorkspaceState>{rows.length ? t("list.empty") : t("accounting.issuedEmpty")}</WorkspaceState>
      ) : (
        <ul className="border-t border-line-strong">
          <li className="hidden grid-cols-[8.5rem_6rem_minmax(0,1fr)_6.5rem_6.5rem_6.5rem_7rem] gap-x-3 border-b border-line py-2 text-[11px] font-medium uppercase tracking-[0.06em] text-faint xl:grid">
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
                  className="group grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 py-3 xl:grid-cols-[8.5rem_6rem_minmax(0,1fr)_6.5rem_6.5rem_6.5rem_7rem] xl:items-baseline"
                  data-testid="v5-issued-row" data-layout-group
                >
                  <span className="tnum min-w-0 text-[14px] font-medium group-hover:underline group-hover:underline-offset-4">
                    {invoice.invoiceNumber}
                    <span className="ml-1.5 text-[10px] font-semibold uppercase text-faint">{t(`list.kind.${invoice.invoiceKind ?? "FULL"}` as V5Key)}</span>
                  </span>
                  <span className={`tnum text-right text-[14px] font-semibold xl:hidden ${cancelled ? "text-faint line-through" : ""}`}><Amount usd={invoice.totalUsd} khr={invoice.totalKhr} /></span>
                  <span className="tnum hidden text-[13px] text-muted xl:block">{invoice.invoiceDate}</span>
                  <span className="min-w-0 truncate text-[13px] text-muted">
                    <span className="xl:hidden">{invoice.invoiceDate} · </span>
                    {customer}
                    {invoice.project.name && <span className="text-faint"> · {invoice.project.name}</span>}
                  </span>
                  <span className={`tnum hidden text-right text-[14px] font-semibold xl:block ${cancelled ? "text-faint line-through" : ""}`}><Amount usd={invoice.totalUsd} khr={invoice.totalKhr} /></span>
                  <span className="tnum hidden text-right text-[13px] text-muted xl:block">{cancelled ? "—" : moneyExact(money.paidUsd)}</span>
                  <span className="tnum hidden text-right text-[13px] xl:block" data-testid="v5-row-outstanding">{cancelled ? "—" : moneyExact(money.outstandingUsd)}</span>
                  <span
                    className={`text-right text-[12.5px] ${cancelled ? "text-danger" : rowStatus === "PAID" ? "text-paid" : rowStatus === "PARTIALLY_PAID" ? "text-pending" : "text-muted"}`}
                    data-testid="v5-row-status"
                  >
                    {t(`status.${rowStatus}` as V5Key)}
                    {!cancelled && rowStatus !== "PAID" && <span className="tnum xl:hidden"> · {moneyExact(money.outstandingUsd)}</span>}
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
