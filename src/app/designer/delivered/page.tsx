"use client";

import Link from "next/link";

import { DeliveredMark } from "@/components/delivery";
import { ChevronRight } from "@/components/icons";
import { useI18n } from "@/components/providers";
import { PageSkeleton, useScope } from "@/components/scope";
import { Amount, EmptyState, PageHeader, StatusTag } from "@/components/ui";
import { flowStatus, sum } from "@/lib/derive";
import { mediumDate, money } from "@/lib/format";
import type { BillingItem } from "@/lib/types";

/** Work that has left the designer's hands but is not finished being billed. */
export default function DeliveredPage() {
  const scope = useScope();
  const { t, locale } = useI18n();

  if (!scope) return <PageSkeleton />;

  const groups = Array.from(
    scope.items
      .filter((item) => item.productionStatus === "DELIVERED" && item.billingStatus !== "PAID")
      .reduce((map, item) => {
        const list = map.get(item.projectId) ?? [];
        list.push(item);
        map.set(item.projectId, list);
        return map;
      }, new Map<string, BillingItem[]>()),
  ).sort(([, a], [, b]) => (b[0]?.deliveredAt ?? "").localeCompare(a[0]?.deliveredAt ?? ""));

  return (
    <div className="animate-rise">
      <PageHeader title={t("delivered.title")} subtitle={t("delivered.subtitle")} />

      {groups.length === 0 ? (
        <EmptyState title={t("delivered.empty")} />
      ) : (
        <div className="divide-y divide-line border-y border-line bg-panel sm:mx-8 sm:rounded-2xl sm:border">
          {groups.map(([projectId, items]) => (
            <Link
              key={projectId}
              href={`/designer/projects/${projectId}`}
              className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-fill sm:px-6"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium tracking-[-0.01em]">
                  {scope.idx.projectById.get(projectId)?.name}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12.5px] text-faint">
                  <span>{scope.clientOf(projectId)?.name}</span>
                  <DeliveredMark
                    date={
                      items[0]?.deliveredAt
                        ? mediumDate(items[0].deliveredAt.slice(0, 10), locale)
                        : undefined
                    }
                  />
                </span>
              </span>
              <StatusTag status={flowStatus(items[0])} className="hidden sm:flex" />
              <Amount value={money(sum(items))} className="text-[15px]" />
              <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
