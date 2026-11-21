"use client";

import { useMemo, useState } from "react";

import { Input, Select } from "@/components/ui";
import { useV5T, type V5Key } from "@/lib/billing-v5/i18n";
import { invoiceCollection } from "@/lib/billing-v5/ontology";
import { phnomPenhDate } from "@/lib/exchange-rate";
import { normalizeSearch, matchesSearch } from "@/lib/billing-v5/project-view";
import { WorkspaceState } from "./workspace-parts";
import { InvoiceWorkspace } from "./invoice-workspace";
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
        <InvoiceWorkspace snapshot={snapshot} invoices={shown.map((row) => row.invoice)} />
      )}
    </section>
  );
}
