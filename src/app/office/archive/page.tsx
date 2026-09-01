"use client";

import { useMemo, useState } from "react";

import { SearchIcon } from "@/components/icons";
import { HistoricalRecordRow } from "@/components/historical-record-row";
import { InvoiceSheet } from "@/components/invoice-sheet";
import { InvoiceListRow } from "@/components/invoice-list-row";
import { useI18n } from "@/components/providers";
import { PageSkeleton, useScope } from "@/components/scope";
import { EmptyState, PageHeader, PageTotal, Select } from "@/components/ui";
import { monthKey } from "@/lib/derive";
import { khrAmount } from "@/lib/exchange-rate";
import {
  archiveInvoiceDate,
  groupHistoricalItems,
  historicalMonth,
  sortArchiveInvoices,
  sortHistoricalGroups,
} from "@/lib/historical";
import { money, monthLabel } from "@/lib/format";
import type { Invoice } from "@/lib/types";

export default function ArchivePage() {
  const scope = useScope();
  const { t, locale } = useI18n();
  const [query, setQuery] = useState("");
  const [month, setMonth] = useState("");
  const [open, setOpen] = useState<Invoice | null>(null);

  const paid = useMemo(
    () => sortArchiveInvoices((scope?.invoices ?? []).filter((invoice) => invoice.status === "PAID")),
    [scope],
  );

  const historical = useMemo(
    () =>
      scope
        ? groupHistoricalItems(scope.items, scope.idx.projectById, scope.idx.clientById)
        : [],
    [scope],
  );

  const months = useMemo(() => {
    const keys = new Set<string>();
    for (const invoice of paid) {
      const date = archiveInvoiceDate(invoice);
      if (date) keys.add(monthKey(date));
    }
    for (const group of historical) {
      for (const item of group.items) keys.add(historicalMonth(item));
    }
    return Array.from(keys).sort().reverse();
  }, [paid, historical]);

  const paidRows = useMemo(() => {
    if (!scope) return [];
    const term = query.trim().toLowerCase();
    return paid.filter((invoice) => {
      const date = archiveInvoiceDate(invoice);
      if (month && monthKey(date) !== month) return false;
      if (!term) return true;
      const client = scope.idx.clientById.get(invoice.clientId)?.name ?? "";
      const projects = (scope.idx.itemsByInvoice.get(invoice.id) ?? [])
        .map((item) => scope.idx.projectById.get(item.projectId)?.name ?? "")
        .join(" ");
      return `${invoice.invoiceNumber} ${client} ${projects}`.toLowerCase().includes(term);
    });
  }, [paid, query, month, scope]);

  const historyRows = useMemo(() => {
    const term = query.trim().toLowerCase();
    const rows = historical.flatMap((group) => {
      const items = month
        ? group.items.filter((item) => historicalMonth(item) === month)
        : group.items;
      if (!items.length) return [];
      if (term) {
        const searchable = `${group.project.name} ${group.client.name} ${items
          .map((item) => item.description)
          .join(" ")}`.toLowerCase();
        if (!searchable.includes(term)) return [];
      }
      return [{
        ...group,
        items,
        amount: items.reduce((total, item) => total + item.amount, 0),
        months: Array.from(new Set(items.map(historicalMonth))).sort(
          (a, b) => b.localeCompare(a),
        ),
        statuses: Array.from(
          new Set(
            items.map((item) =>
              item.billingStatus === "INVOICED"
                ? ("INVOICED" as const)
                : ("NEEDS_REVIEW" as const),
            ),
          ),
        ),
      }];
    });
    return sortHistoricalGroups(rows);
  }, [historical, query, month]);

  const hasAnyArchive = paid.length > 0 || historical.length > 0;

  const knownTotal =
    paidRows.reduce((total, invoice) => total + invoice.amount, 0) +
    historyRows.reduce((total, group) => total + group.amount, 0);
  const khrTotal =
    historyRows.length === 0 && paidRows.length > 0 && paidRows.every(
      (invoice) => invoice.exchangeRate && invoice.exchangeRate > 0,
    )
      ? paidRows.reduce((total, invoice) => total + khrAmount(invoice.amount, invoice.exchangeRate!), 0)
      : null;

  if (!scope) return <PageSkeleton />;

  return (
    <div className="animate-rise">
      <PageHeader
        title={t("archive.title")}
        subtitle={t("archive.summary", {
          invoices: paid.length,
          history: historical.reduce((total, group) => total + group.items.length, 0),
        })}
        action={
          <PageTotal
            value={knownTotal > 0 ? money(knownTotal) : "—"}
            label={t("projects.knownTotal")}
            secondaryValue={khrTotal == null ? undefined : `៛${khrTotal.toLocaleString("en-US")}`}
          />
        }
      />

      <div className="flex flex-col gap-2.5 px-5 pb-5 sm:flex-row sm:items-center sm:px-8">
        <div className="relative flex-1 sm:max-w-sm">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("archive.searchPlaceholder")}
            aria-label={t("archive.search")}
            className="h-10 w-full rounded-xl bg-fill pl-9 pr-3 text-[14px] placeholder:text-faint focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <div className="sm:w-52">
        <Select
          variant="filter"
          value={month}
          onChange={(event) => setMonth(event.target.value)}
          aria-label={t("archive.allMonths")}
        >
          <option value="">{t("archive.allMonths")}</option>
          {months.map((key) => (
            <option key={key} value={key}>
              {monthLabel(key, locale)}
            </option>
          ))}
        </Select>
        </div>
      </div>

      {!hasAnyArchive ? (
        <EmptyState title={t("archive.empty")} hint={t("archive.emptyHint")} />
      ) : paidRows.length === 0 && historyRows.length === 0 ? (
        <EmptyState title={t("archive.noMatch")} />
      ) : (
        <div className="space-y-8 pb-10">
          {paidRows.length > 0 && (
            <section>
              <h2 className="px-5 pb-2 text-[15px] font-semibold sm:px-8">
                {t("archive.paidSection")}
              </h2>
              <div className="divide-y divide-line border-y border-line bg-panel sm:mx-8 sm:rounded-2xl sm:border">
                {paidRows.map((invoice) => (
                  <InvoiceListRow key={invoice.id} invoice={invoice} onOpen={setOpen} />
                ))}
              </div>
            </section>
          )}

          {historyRows.length > 0 && (
            <section>
              <h2 className="px-5 pb-2 text-[15px] font-semibold sm:px-8">
                {t("archive.historySection")}
              </h2>
              <div className="space-y-3 sm:px-8">
                {historyRows.map((group) => (
                  <HistoricalRecordRow key={group.projectId} group={group} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      <InvoiceSheet invoice={open} onClose={() => setOpen(null)} />
    </div>
  );
}
