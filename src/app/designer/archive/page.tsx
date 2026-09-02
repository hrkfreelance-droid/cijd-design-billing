"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { CompactSummaryHeader } from "@/components/compact-summary-header";
import { ChevronRight, SearchIcon } from "@/components/icons";
import { useI18n } from "@/components/providers";
import { PageSkeleton, useScope } from "@/components/scope";
import { Amount, EmptyState, Select, StatusTag } from "@/components/ui";
import { flowStatus, sum } from "@/lib/derive";
import { groupHistoricalItems, historicalMonth, sortHistoricalGroups } from "@/lib/historical";
import { money, monthLabel } from "@/lib/format";

/** Imported history, kept outside the designer's active workload. */
export default function ProductionArchivePage() {
  const scope = useScope();
  const { t, locale } = useI18n();
  const [query, setQuery] = useState("");
  const [month, setMonth] = useState("");

  const groups = useMemo(
    () =>
      scope
        ? groupHistoricalItems(scope.items, scope.idx.projectById, scope.idx.clientById)
        : [],
    [scope],
  );

  const months = useMemo(() => {
    const keys = new Set<string>();
    for (const group of groups) {
      for (const item of group.items) {
        const key = historicalMonth(item);
        if (key) keys.add(key);
      }
    }
    return Array.from(keys).sort().reverse();
  }, [groups]);

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    const filtered = groups.flatMap((group) => {
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
        amount: sum(items),
        months: Array.from(new Set(items.map(historicalMonth))).sort(
          (a, b) => b.localeCompare(a),
        ),
        statuses: Array.from(new Set(items.map(flowStatus))),
      }];
    });
    return sortHistoricalGroups(filtered);
  }, [groups, query, month]);

  const archiveTotal = useMemo(() => {
    return sum(rows.flatMap((group) => group.items));
  }, [rows]);

  if (!scope) return <PageSkeleton />;

  return (
    <div className="animate-rise">
      <CompactSummaryHeader
        title={t("productionArchive.title")}
        subtitle={t("productionArchive.subtitle")}
        label={t("projects.knownTotal")}
        value={archiveTotal > 0 ? money(archiveTotal) : "—"}
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

      {groups.length === 0 ? (
        <EmptyState
          title={t("productionArchive.empty")}
          hint={t("productionArchive.emptyHint")}
        />
      ) : rows.length === 0 ? (
        <EmptyState title={t("archive.noMatch")} />
      ) : (
        <div className="divide-y divide-line border-y border-line bg-panel sm:mx-8 sm:rounded-2xl sm:border">
          {rows.map((group) => (
            <Link
              key={group.projectId}
              href={`/designer/projects/${group.projectId}?view=history`}
              data-historical-latest-month={group.months[0] ?? ""}
              className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-fill sm:px-6"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium tracking-[-0.01em]">
                  {group.project?.name}
                </span>
                <span className="mt-0.5 block truncate text-[12.5px] text-faint">
                  {group.client.name} · {group.months.map((key) => monthLabel(key, locale)).join(" · ")} ·{" "}
                  {t("productionArchive.items", { count: group.items.length })}
                </span>
                <span className="mt-1 flex flex-wrap gap-1.5">
                  {group.statuses.map((status) => (
                    <StatusTag key={status} status={status} />
                  ))}
                </span>
              </span>
              <Amount
                value={sum(group.items) > 0 ? money(sum(group.items)) : "—"}
                className="text-[15px]"
              />
              <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
