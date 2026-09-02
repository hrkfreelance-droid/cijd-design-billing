"use client";

import { useState } from "react";

import { api, useData, useI18n, useToast } from "@/components/providers";
import { NBC_OFFICIAL_URL, formatRate } from "@/lib/exchange-rate";
import { formatPhnomPenhDateTime, mediumDate } from "@/lib/format";

export function OfficeExchangeRateStrip() {
  const { snapshot, refresh } = useData();
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const rate = snapshot?.exchangeRate;

  if (!rate) return null;

  const checkedAt = formatPhnomPenhDateTime(snapshot?.exchangeRateLastCheckedAt, locale);

  const refreshRate = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const result = await api<{ checked: boolean }>("/api/exchange-rate/refresh", { method: "POST" });
      await refresh();
      toast(t(result.checked ? "currency.refreshSuccess" : "currency.refreshRecent"));
    } catch {
      toast(t("currency.refreshError"), "error");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="border-b border-line px-5 sm:px-8" data-testid="office-exchange-rate-strip">
      <div className="flex min-h-9 min-w-0 items-center justify-between gap-3 py-1.5 text-[10.5px] text-faint">
        <div className="min-w-0 truncate">
          <span>{copy(locale, "換算レート", "Exchange rate")}</span>
          <span className="mx-1.5">·</span>
          <a
            href={NBC_OFFICIAL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-muted underline-offset-2 hover:text-text hover:underline"
          >
            NBC ↗
          </a>
          <span className="mx-1.5">·</span>
          <span className="tnum text-muted">{formatRate(rate.rate)} KHR/USD</span>
          <span className="mx-1.5">·</span>
          <span>{mediumDate(rate.effectiveDate, locale)}</span>
          {checkedAt ? (
            <>
              <span className="mx-1.5 hidden sm:inline">·</span>
              <span className="hidden sm:inline">{copy(locale, "確認", "Checked")} {checkedAt}</span>
            </>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void refreshRate()}
          disabled={refreshing}
          aria-busy={refreshing}
          className="shrink-0 rounded-full px-2 py-1 font-medium text-muted transition-colors hover:bg-fill hover:text-text disabled:cursor-wait disabled:text-faint"
        >
          {refreshing ? copy(locale, "更新中", "Refreshing") : copy(locale, "更新", "Refresh")}
        </button>
      </div>
    </div>
  );
}

function copy(locale: string, ja: string, en: string) {
  return locale === "ja" ? ja : en;
}
