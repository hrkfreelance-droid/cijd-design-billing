"use client";

import { useMemo, useState } from "react";

import { ItemProductionAction } from "@/components/delivery";
import { api, useI18n, useSession } from "@/components/providers";
import { PageSkeleton, useScope } from "@/components/scope";
import { useAction } from "@/components/use-action";
import { useLinkedAmounts } from "@/components/use-linked-amounts";
import { Amount, Button, EmptyState, Field, Input, PageHeader, PageTotal, Sheet, StatusPill, type WorkStatus } from "@/components/ui";
import {
  isBillingLocked,
  isHistoricalRecord,
  isProductionComplete,
  printPriceReviewState,
} from "@/lib/derive";
import { mediumDate, money, roundMoney } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { suggestedPrintBillingTotal } from "@/lib/print-pricing";
import type { BillingItem } from "@/lib/types";

export type PrintingView = "review" | "history";

export function PrintingWorkspace({ view }: { view: PrintingView }) {
  const scope = useScope();
  const { t, locale } = useI18n();

  const items = useMemo(() => {
    if (!scope) return [];
    return scope.items
      .filter((item) => item.type === "PRINT")
      .filter((item) => view === "history" ? isHistoricalRecord(item) : !isHistoricalRecord(item))
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [scope, view]);

  const projectGroups = useMemo(() => {
    const grouped = new Map<string, { project?: { name: string; date: string }; client?: { name: string }; items: BillingItem[] }>();
    for (const item of items) {
      const project = scope?.idx.projectById.get(item.projectId);
      const client = project ? scope?.idx.clientById.get(project.clientId) : undefined;
      const current = grouped.get(item.projectId);
      if (current) current.items.push(item);
      else grouped.set(item.projectId, { project, client, items: [item] });
    }
    return Array.from(grouped.values()).sort((a, b) =>
      (a.project?.date ?? "").localeCompare(b.project?.date ?? ""),
    );
  }, [items, scope]);

  if (!scope) return <PageSkeleton />;

  const title = view === "review" ? t("printing.title") : t("printing.historyTitle");
  const subtitle = view === "review" ? t("printing.reviewSubtitle") : t("printing.historySubtitle");
  const totalCost = roundMoney(items.reduce((total, item) => total + Math.max(item.printCostAmount ?? 0, 0), 0));

  return (
    <div className="animate-rise">
      <PageHeader
        title={title}
        subtitle={
          <span>
            {subtitle}
            {view === "review" && <span className="ml-2 text-review">{t("printing.reviewCount", { count: items.length })}</span>}
          </span>
        }
        action={
          <PageTotal
            value={totalCost > 0 ? money(totalCost) : "—"}
            label={copy(locale, "印刷原価", "Print cost")}
            showRateActions={false}
          />
        }
      />

      {items.length === 0 ? (
        <EmptyState title={view === "history" ? t("printing.emptyHistory") : t("printing.emptyReview")} />
      ) : (
        <div className="space-y-3 px-5 pb-10 sm:px-8">
          {projectGroups.map((group) => (
            <PrintProjectBlock key={group.items[0].projectId} group={group} locale={locale} history={view === "history"} />
          ))}
        </div>
      )}
    </div>
  );
}

function PrintProjectBlock({
  group,
  locale,
  history,
}: {
  group: { project?: { name: string; date: string }; client?: { name: string }; items: BillingItem[] };
  locale: Locale;
  history: boolean;
}) {
  const totalCost = roundMoney(group.items.reduce((total, item) => total + (item.printCostAmount ?? 0), 0));

  return (
    <section data-testid="printing-project-group" className="overflow-hidden border-y border-line bg-panel sm:rounded-2xl sm:border">
      <div className="border-b border-line px-5 py-2 sm:px-6">
        <div className="flex min-w-0 items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate text-[17px] font-semibold tracking-[-0.012em]">{group.project?.name ?? ""}</h2>
            <p className="mt-0.5 truncate text-[12.5px] text-faint">
              {group.client?.name} · {group.project ? mediumDate(group.project.date, locale) : ""}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[10.5px] font-medium uppercase tracking-[0.06em] text-faint">{copy(locale, "原価", "Cost")}</p>
            <Amount value={totalCost > 0 ? money(totalCost) : "—"} strong className="mt-0.5 block text-[15px]" />
          </div>
        </div>
      </div>
      <div className="divide-y divide-line">
        {group.items.map((item) => <PrintItemCard key={item.id} item={item} projectName={group.project?.name} history={history} />)}
      </div>
    </section>
  );
}

function PrintItemCard({ item, projectName, history }: { item: BillingItem; projectName?: string; history: boolean }) {
  const { t, locale } = useI18n();
  const { user } = useSession();
  const [editing, setEditing] = useState(false);
  const review = printPriceReviewState(item);
  const confirmed = review === "CONFIRMED";
  const finished = isProductionComplete(item);
  const locked = isBillingLocked(item);
  const cost = item.printCostAmount ?? 0;
  const costUnit = item.printCostUnitPrice ?? 0;
  const workStatus: WorkStatus = finished ? "DELIVERED" : confirmed ? "IN_PROGRESS" : "NEEDS_REVIEW";
  const canSeeBillingSuggestion = user?.role === "DESIGNER" || user?.role === "ADMIN";

  return (
    <article data-testid="printing-item-card" className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 px-5 py-2 sm:px-6">
      <span className="sr-only">{projectName}</span>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <StatusPill status={workStatus} className="shrink-0" />
          <h3 className="min-w-0 truncate text-[15px] font-medium tracking-[-0.006em]">{item.description}</h3>
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-muted">
          {item.printSize && <span className="truncate">{t("printing.size")}: {item.printSize}</span>}
          <span>×{item.quantity}</span>
          {costUnit > 0 && <span className="tnum whitespace-nowrap">{copy(locale, "原価", "Cost")} {money(costUnit)} / pc</span>}
          {canSeeBillingSuggestion && item.suggestedAmount != null && item.suggestedAmount > 0 && (
            <span className="tnum whitespace-nowrap text-faint">{copy(locale, "推奨請求", "Suggested")} {money(item.suggestedAmount)}</span>
          )}
        </div>
      </div>

      <div className="flex min-w-[92px] flex-col items-end gap-1">
        {cost > 0 ? <Amount value={money(cost)} strong className="text-[14px]" /> : <span className="text-[13px] font-medium text-review">{copy(locale, "原価未入力", "Cost pending")}</span>}
        {!history && !locked && (
          !confirmed ? (
            <Button variant="primary" size="sm" onClick={() => setEditing(true)}>{copy(locale, "原価決定", "Set cost")}</Button>
          ) : (
            <div className="flex flex-col items-end gap-1">
              <Button variant="quiet" size="sm" onClick={() => setEditing(true)}>{copy(locale, "原価修正", "Edit cost")}</Button>
              <ItemProductionAction item={item} size="sm" />
            </div>
          )
        )}
        {history && <span className="whitespace-nowrap text-[11.5px] text-faint">{t("printing.historyReadOnly")}</span>}
        {!history && locked && <span className="whitespace-nowrap text-[11.5px] text-faint">{t("project.lockedNotice")}</span>}
      </div>

      {!locked && <PrintEditSheet item={item} open={editing} onClose={() => setEditing(false)} />}
    </article>
  );
}

function PrintEditSheet({ item, open, onClose }: { item: BillingItem; open: boolean; onClose: () => void }) {
  const { locale } = useI18n();
  const { run, busy } = useAction();
  const [size, setSize] = useState(item.printSize ?? "");
  const [quantity, setQuantity] = useState(String(item.quantity));
  const cost = useLinkedAmounts({
    quantity,
    initialUnit: item.printCostUnitPrice,
    initialTotal: item.printCostAmount,
    initialSource: "unit",
  });

  const quantityValue = parseNumber(quantity);
  const costUnitValue = cost.unitNumber;
  const costTotal = cost.totalNumber ?? 0;
  const suggested = costTotal > 0 ? suggestedPrintBillingTotal(costTotal) : 0;
  const valid = !!quantityValue && quantityValue > 0 && costUnitValue != null && costUnitValue > 0 && costTotal > 0;

  const setCost = async () => {
    if (!valid || quantityValue == null || costUnitValue == null) return;
    const ok = await run(
      async () => {
        await api(`/api/printing-items/${item.id}/spec`, {
          method: "PATCH",
          body: { printSize: size, quantity: quantityValue },
        });
        await api(`/api/printing-items/${item.id}/price`, {
          method: "POST",
          body: { unitPrice: costUnitValue, amount: costTotal, confirm: true },
        });
      },
      { key: "toast.itemUpdated" },
    );
    if (ok) onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={copy(locale, "印刷原価を決定", "Set print cost")}
      description={copy(locale, "ここで入力する金額は顧客請求ではなく原価です", "This is internal cost, not the customer billing price")}
      footer={
        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          <Button variant="secondary" full onClick={onClose}>{copy(locale, "キャンセル", "Cancel")}</Button>
          <Button variant="primary" full onClick={setCost} disabled={busy || !valid}>{copy(locale, "原価を確定", "Confirm cost")}</Button>
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label={copy(locale, "サイズ / 仕様", "Size / spec")}>
          <Input value={size} onChange={(event) => setSize(event.target.value)} placeholder="e.g. Name Card" />
        </Field>
        <Field label={copy(locale, "数量", "Quantity")}>
          <Input inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="tnum" />
        </Field>

        <div className="space-y-3 rounded-2xl border border-line bg-fill/40 p-3.5">
          <p className="text-[12px] leading-relaxed text-muted">
            {copy(locale, "単価・合計どちらを入力しても、もう片方を自動計算します。", "Enter either unit cost or total cost. The other value updates automatically.")}
          </p>
          <Field label={copy(locale, "原価 / 1個", "Cost / unit")}>
            <Input inputMode="decimal" value={cost.unit} onChange={(event) => cost.setUnit(event.target.value)} placeholder="0" className="tnum" />
          </Field>
          <Field label={copy(locale, "原価合計", "Cost total")}>
            <Input inputMode="decimal" value={cost.total} onChange={(event) => cost.setTotal(event.target.value)} placeholder="0" className="tnum" />
          </Field>
        </div>

        <div className="rounded-2xl bg-fill px-3.5 py-3">
          <p className="text-[11.5px] text-faint">{copy(locale, "Billingへの推奨価格", "Suggested billing price")}</p>
          <Amount value={suggested > 0 ? money(suggested) : "—"} strong className="mt-1 block text-[18px]" />
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            {copy(locale, "原価に利益を載せ、5ドル / 10ドル単位で上方向に丸めます。Billing側で最終価格を修正できます。", "Margin is applied and rounded upward to clean $5 / $10 steps. Billing can edit the final price.")}
          </p>
        </div>
      </div>
    </Sheet>
  );
}

function parseNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function copy(locale: string, ja: string, en: string) {
  return locale === "ja" ? ja : en;
}
