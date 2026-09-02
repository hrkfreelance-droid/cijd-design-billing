"use client";

import { useMemo, useState } from "react";

import { ItemProductionAction } from "@/components/delivery";
import { api, useI18n, useSession } from "@/components/providers";
import { PageSkeleton, useScope } from "@/components/scope";
import { useAction } from "@/components/use-action";
import { useLinkedAmounts } from "@/components/use-linked-amounts";
import { Amount, Button, EmptyState, Field, Input, Sheet, StatusPill, type WorkStatus } from "@/components/ui";
import { isBillingLocked, isHistoricalRecord, isProductionComplete, printPriceReviewState } from "@/lib/derive";
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

  const groups = useMemo(() => {
    const map = new Map<string, { project?: { name: string; date: string }; client?: { name: string }; items: BillingItem[] }>();
    for (const item of items) {
      const project = scope?.idx.projectById.get(item.projectId);
      const client = project ? scope?.idx.clientById.get(project.clientId) : undefined;
      const existing = map.get(item.projectId);
      if (existing) existing.items.push(item);
      else map.set(item.projectId, { project, client, items: [item] });
    }
    return Array.from(map.values()).sort((a, b) => (a.project?.date ?? "").localeCompare(b.project?.date ?? ""));
  }, [items, scope]);

  if (!scope) return <PageSkeleton />;

  const totalCost = roundMoney(items.reduce((total, item) => total + Math.max(item.printCostAmount ?? 0, 0), 0));
  const pending = items.filter((item) => printPriceReviewState(item) !== "CONFIRMED").length;

  return (
    <div className="animate-rise mx-auto w-full max-w-[1000px] px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold tracking-[-0.025em] text-text sm:text-[32px]">
            {view === "review" ? t("printing.title") : t("printing.historyTitle")}
          </h1>
          <p className="mt-1 text-[13px] text-muted">
            {items.length} {copy(locale, "件", "items")}
            {view === "review" && pending > 0 ? ` · ${pending} ${copy(locale, "原価待ち", "pending")}` : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-faint">{copy(locale, "印刷原価", "Print cost")}</p>
          <Amount value={totalCost > 0 ? money(totalCost) : "—"} strong className="mt-0.5 block text-[22px]" />
        </div>
      </header>

      {items.length === 0 ? (
        <EmptyState title={view === "history" ? t("printing.emptyHistory") : t("printing.emptyReview")} />
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
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
    <section className="overflow-hidden rounded-2xl border border-line bg-panel">
      <div className="flex items-center justify-between gap-4 px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h2 className="truncate text-[16px] font-semibold">{group.project?.name ?? ""}</h2>
          <p className="mt-0.5 truncate text-[11.5px] text-faint">
            {group.client?.name}{group.project ? ` · ${mediumDate(group.project.date, locale)}` : ""}
          </p>
        </div>
        <Amount value={totalCost > 0 ? money(totalCost) : "—"} strong className="text-[15px]" />
      </div>
      <div className="divide-y divide-line border-t border-line">
        {group.items.map((item) => <PrintItemRow key={item.id} item={item} history={history} />)}
      </div>
    </section>
  );
}

function PrintItemRow({ item, history }: { item: BillingItem; history: boolean }) {
  const { locale } = useI18n();
  const { user } = useSession();
  const [editing, setEditing] = useState(false);
  const review = printPriceReviewState(item);
  const confirmed = review === "CONFIRMED";
  const finished = isProductionComplete(item);
  const locked = isBillingLocked(item);
  const status: WorkStatus = finished ? "DELIVERED" : confirmed ? "IN_PROGRESS" : "NEEDS_REVIEW";
  const cost = item.printCostAmount ?? 0;
  const canSeeSuggestion = user?.role === "DESIGNER" || user?.role === "ADMIN";

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 sm:px-5">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <StatusPill status={status} className="shrink-0" />
          <p className="truncate text-[14.5px] font-medium">{item.description}</p>
        </div>
        <p className="mt-1 truncate text-[11.5px] text-faint">
          {item.printSize ? `${item.printSize} · ` : ""}×{item.quantity}
          {canSeeSuggestion && item.suggestedAmount ? ` · ${copy(locale, "推奨", "Suggested")} ${money(item.suggestedAmount)}` : ""}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Amount value={cost > 0 ? money(cost) : "—"} strong className="text-[14px]" />
        {!history && !locked && (
          confirmed ? (
            <>
              <Button variant="quiet" size="sm" onClick={() => setEditing(true)}>{copy(locale, "修正", "Edit")}</Button>
              <ItemProductionAction item={item} size="sm" />
            </>
          ) : (
            <Button variant="primary" size="sm" onClick={() => setEditing(true)}>{copy(locale, "原価入力", "Set cost")}</Button>
          )
        )}
      </div>

      {!locked && <PrintEditSheet item={item} open={editing} onClose={() => setEditing(false)} />}
    </div>
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
    initialSource: item.printCostAmount ? "total" : "unit",
  });

  const qty = parseNumber(quantity);
  const unit = cost.unitNumber;
  const total = cost.totalNumber ?? 0;
  const suggested = total > 0 ? suggestedPrintBillingTotal(total) : 0;
  const valid = !!qty && qty > 0 && unit != null && unit > 0 && total > 0;

  const save = async () => {
    if (!valid || qty == null || unit == null) return;
    const ok = await run(
      async () => {
        await api(`/api/printing-items/${item.id}/spec`, {
          method: "PATCH",
          body: { printSize: size, quantity: qty },
        });
        await api(`/api/printing-items/${item.id}/price`, {
          method: "POST",
          body: { unitPrice: unit, amount: total, confirm: true },
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
      title={copy(locale, "印刷原価", "Print cost")}
      description={copy(locale, "合計・単価のどちらを入力しても、もう片方を自動計算します", "Enter either total cost or unit cost; the other updates automatically")}
      footer={
        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          <Button variant="secondary" full onClick={onClose}>{copy(locale, "キャンセル", "Cancel")}</Button>
          <Button variant="primary" full onClick={save} disabled={busy || !valid}>{copy(locale, "確定", "Confirm")}</Button>
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
        <Field label={copy(locale, "原価合計", "Cost total")}>
          <Input inputMode="decimal" value={cost.total} onChange={(event) => cost.setTotal(event.target.value)} placeholder="0" className="tnum" />
        </Field>
        <Field label={copy(locale, "原価 / 1個", "Cost / unit")}>
          <Input inputMode="decimal" value={cost.unit} onChange={(event) => cost.setUnit(event.target.value)} placeholder="0" className="tnum" />
        </Field>
        <div className="flex items-center justify-between border-t border-line pt-3">
          <span className="text-[12.5px] text-muted">{copy(locale, "推奨請求額", "Suggested billing")}</span>
          <Amount value={suggested > 0 ? money(suggested) : "—"} strong className="text-[16px]" />
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
