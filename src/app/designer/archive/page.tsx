"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { ChevronRight, SearchIcon } from "@/components/icons";
import { useI18n } from "@/components/providers";
import { PageSkeleton, useScope } from "@/components/scope";
import { Amount, EmptyState, PageHeader, Select } from "@/components/ui";
import { monthKey, sum } from "@/lib/derive";
import { mediumDate, money, monthLabel } from "@/lib/format";
import type { BillingItem } from "@/lib/types";

/** Production history: finished work, without any invoice or payment detail. */
export default function ProductionArchivePage() {
  const scope = useScope();
  const { t, locale } = useI18n();
  const [query, setQuery] = useState("");
  const [month, setMonth] = useState("");

  const groups = useMemo(() => {
    if (!scope) return [];
    const byProject = new Map<string, BillingItem[]>();
    for (const item of scope.items) {
      const list = byProject.get(item.projectId) ?? [];
      list.push(item);
      byProject.set(item.projectId, list);
    }
    return Array.from(byProject)
      .filter(([, items]) => items.every((item) => item.billingStatus === "PAID"))
      .map(([projectId, items]) => ({
        projectId,
        items,
        project: scope.idx.projectById.get(projectId),
        client: scope.clientOf(projectId),
        deliveredAt: items[0]?.deliveredAt ?? null,
      }))
      .sort((a, b) => (b.project?.date ?? "").localeCompare(a.project?.date ?? ""));
  }, [scope]);

  const months = useMemo(() => {
    const keys = new Set<string>();
    for (const group of groups) if (group.project) keys.add(monthKey(group.project.date));
    return Array.from(keys).sort().reverse();
  }, [groups]);

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return groups.filter((group) => {
      if (month && group.project && monthKey(group.project.date) !== month) return false;
      if (!term) return true;
      return `${group.project?.name ?? ""} ${group.client?.name ?? ""}`
        .toLowerCase()
        .includes(term);
    });
  }, [groups, query, month]);

  if (!scope) return <PageSkeleton />;

  return (
    <div className="animate-rise">
      <PageHeader
        title={t("productionArchive.title")}
        subtitle={t("productionArchive.subtitle")}
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
        <EmptyState title={t("productionArchive.empty")} />
      ) : rows.length === 0 ? (
        <EmptyState title={t("archive.noMatch")} />
      ) : (
        <div className="divide-y divide-line border-y border-line bg-panel sm:mx-8 sm:rounded-2xl sm:border">
          {rows.map((group) => (
            <Link
              key={group.projectId}
              href={`/designer/projects/${group.projectId}`}
              className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-fill sm:px-6"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium tracking-[-0.01em]">
                  {group.project?.name}
                </span>
                <span className="mt-0.5 block truncate text-[12.5px] text-faint">
                  {group.client?.name}
                  {group.project ? ` · ${mediumDate(group.project.date, locale)}` : ""}
                </span>
              </span>
              <Amount value={money(sum(group.items))} className="text-[15px]" />
              <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
