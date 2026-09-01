"use client";

import { useI18n } from "@/components/providers";
import { StatusTag } from "@/components/ui";
import type { HistoricalGroup } from "@/lib/historical";
import { money } from "@/lib/format";

export function HistoricalRecordRow({ group }: { group: HistoricalGroup }) {
  const { t, locale } = useI18n();
  const amount = group.items.reduce((total, item) => total + item.amount, 0);

  return (
    <article
      data-testid="historical-record"
      className="border-y border-line bg-panel px-5 py-4 first:border-t-0 sm:rounded-2xl sm:border sm:px-6"
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-medium tracking-[-0.01em]">
            {group.project.name}
          </h3>
          <p className="mt-0.5 truncate text-[12.5px] text-faint">
            {group.client.name} · {group.months.map((month) => formatMonth(month, locale)).join(" · ")}
          </p>
        </div>
        <span className="shrink-0 text-[12px] font-medium text-muted">
          {t("archive.historical")}
        </span>
      </div>

      <div className="mt-3 divide-y divide-line border-t border-line">
        {group.items.map((item) => (
          <div key={item.id} className="flex min-w-0 items-center gap-3 py-2.5 last:pb-0">
            <span className="min-w-0 flex-1 truncate text-[13.5px]">
              {item.description || t("archive.historicalWork")}
            </span>
            <StatusTag status={item.billingStatus === "INVOICED" ? "INVOICED" : "NEEDS_REVIEW"} />
            <span className="shrink-0 text-[13.5px] tnum">
              {item.amount > 0 ? money(item.amount) : "—"}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
        <span className="text-[12px] text-faint">
          {t("archive.historicalItems", { count: group.items.length })}
        </span>
        <span className="text-[14px] font-medium tnum">
          {amount > 0 ? money(amount) : "—"}
        </span>
      </div>
    </article>
  );
}

function formatMonth(month: string, locale: "ja" | "en"): string {
  const [year, rawMonth] = month.split("-").map(Number);
  if (!year || !rawMonth) return month;
  return new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "en-US", {
    year: "numeric",
    month: "short",
  }).format(new Date(year, rawMonth - 1, 1));
}
