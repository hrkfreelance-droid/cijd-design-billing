"use client";

import { useMemo, useState } from "react";

import { ChevronRight, SearchIcon } from "@/components/icons";
import { InvoiceSheet } from "@/components/invoice-sheet";
import { useI18n } from "@/components/providers";
import { PageSkeleton, useScope } from "@/components/scope";
import { Amount, EmptyState, PageHeader, Select } from "@/components/ui";
import { monthKey } from "@/lib/derive";
import { mediumDate, money, monthLabel } from "@/lib/format";
import type { Invoice } from "@/lib/types";

export default function ArchivePage() {
  const scope = useScope();
  const { t, locale } = useI18n();
  const [query, setQuery] = useState("");
  const [month, setMonth] = useState("");
  const [open, setOpen] = useState<Invoice | null>(null);

  const paid = useMemo(
    () =>
      (scope?.invoices ?? [])
        .filter((invoice) => invoice.status === "PAID")
        .sort((a, b) => (b.paymentDate ?? "").localeCompare(a.paymentDate ?? "")),
    [scope],
  );

  const months = useMemo(() => {
    const keys = new Set<string>();
    for (const invoice of paid) {
      if (invoice.paymentDate) keys.add(monthKey(invoice.paymentDate));
    }
    return Array.from(keys).sort().reverse();
  }, [paid]);

  const rows = useMemo(() => {
    if (!scope) return [];
    const term = query.trim().toLowerCase();
    return paid.filter((invoice) => {
      if (month && monthKey(invoice.paymentDate ?? "") !== month) return false;
      if (!term) return true;
      const client = scope.idx.clientById.get(invoice.clientId)?.name ?? "";
      const projects = (scope.idx.itemsByInvoice.get(invoice.id) ?? [])
        .map((item) => scope.idx.projectById.get(item.projectId)?.name ?? "")
        .join(" ");
      return `${invoice.invoiceNumber} ${client} ${projects}`.toLowerCase().includes(term);
    });
  }, [paid, query, month, scope]);

  if (!scope) return <PageSkeleton />;

  return (
    <div className="animate-rise">
      <PageHeader
        title={t("archive.title")}
        subtitle={t("archive.count", { count: paid.length })}
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

      {paid.length === 0 ? (
        <EmptyState title={t("archive.empty")} hint={t("archive.emptyHint")} />
      ) : rows.length === 0 ? (
        <EmptyState title={t("archive.noMatch")} />
      ) : (
        <div className="divide-y divide-line border-y border-line bg-panel sm:mx-8 sm:rounded-2xl sm:border">
          {rows.map((invoice) => {
            const items = scope.idx.itemsByInvoice.get(invoice.id) ?? [];
            const projects = Array.from(
              new Set(
                items.map((item) => scope.idx.projectById.get(item.projectId)?.name ?? ""),
              ),
            ).join(", ");
            return (
              <button
                key={invoice.id}
                onClick={() => setOpen(invoice)}
                className="flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors duration-150 hover:bg-fill active:bg-fill sm:px-6"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="truncate text-[15px] font-medium tracking-[-0.01em]">
                      {invoice.invoiceNumber ?? "Unknown"}
                    </span>
                    <span className="truncate text-[12.5px] text-muted">
                      {scope.idx.clientById.get(invoice.clientId)?.name}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-[12.5px] text-faint">
                    {projects}
                  </span>
                </span>
                <span className="hidden text-[12.5px] text-faint sm:block">
                  {invoice.paymentDate
                    ? t("archive.paidOn", { date: mediumDate(invoice.paymentDate, locale) })
                    : ""}
                </span>
                <Amount value={money(invoice.amount)} className="text-[15px]" />
                <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
              </button>
            );
          })}
        </div>
      )}

      <InvoiceSheet invoice={open} onClose={() => setOpen(null)} />
    </div>
  );
}
