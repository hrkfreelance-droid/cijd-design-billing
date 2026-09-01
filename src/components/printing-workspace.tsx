"use client";

import { useMemo, useState } from "react";

import { ItemProductionAction } from "@/components/delivery";
import { CurrencyAmount } from "@/components/currency-amount";
import { api, useI18n } from "@/components/providers";
import { PageSkeleton, useScope } from "@/components/scope";
import { useAction } from "@/components/use-action";
import { Amount, Button, EmptyState, Field, Input, PageHeader, PageTotal, Sheet, StatusPill, type WorkStatus } from "@/components/ui";
import {
  isBillingLocked,
  isHistoricalRecord,
  isProductionComplete,
  printPriceReviewState,
  sum,
} from "@/lib/derive";
import { formatKhr } from "@/lib/exchange-rate";
import { mediumDate, money, roundMoney } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { BillingItem } from "@/lib/types";

export type PrintingView = "review" | "history";

export function PrintingWorkspace({ view }: { view: PrintingView }) {
  const scope = useScope();
  const { t, locale } = useI18n();

  const items = useMemo(() => {
    if (!scope) return [];
    return scope.items
      .filter((item) => item.type === "PRINT")
      .filter((item) => {
        if (view === "history") return isHistoricalRecord(item);
        return !isHistoricalRecord(item);
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [scope, view]);

  const projectGroups = useMemo(() => {
    const grouped = new Map<
      string,
      { project?: { name: string; date: string }; client?: { name: string }; items: BillingItem[] }
    >();
    for (const item of items) {
      const project = scope?.idx.projectById.get(item.projectId);
      const client = project ? scope?.idx.clientById.get(project.clientId) : undefined;
      const current = grouped.get(item.projectId);
      if (current) current.items.push(item);
      else grouped.set(item.projectId, { project, client, items: [item] });
    }
    return Array.from(grouped.values());
  }, [items, scope]);

  if (!scope) return <PageSkeleton />;

  const title = view === "review" ? t("printing.title") : t("printing.historyTitle");
  const subtitle = view === "review" ? t("printing.reviewSubtitle") : t("printing.historySubtitle");
  const knownTotal = roundMoney(items.reduce((total, item) => total + Math.max(item.amount, 0), 0));
  const totalLabel =
    view === "history"
      ? t("projects.knownTotal")
      : items.some((item) => printPriceReviewState(item) !== "CONFIRMED")
        ? t("projects.estimatedTotal")
        : undefined;
  const exchangeRate = scope.snapshot.exchangeRate;

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
            value={knownTotal > 0 ? money(knownTotal) : "—"}
            label={totalLabel}
            secondaryValue={exchangeRate ? formatKhr(knownTotal, exchangeRate.rate) : undefined}
            secondaryLabel={exchangeRate ? t("currency.rate", { rate: exchangeRate.rate }) : undefined}
            rateEffectiveDate={exchangeRate?.effectiveDate}
            rateFetchedAt={exchangeRate?.fetchedAt}
          />
        }
      />

      {items.length === 0 ? (
        <EmptyState
          title={view === "history" ? t("printing.emptyHistory") : t("printing.emptyReview")}
        />
      ) : (
        <div className="space-y-4 px-5 pb-10 sm:px-8">
          {projectGroups.map((group) => (
            <PrintProjectBlock
              key={group.project?.name ?? group.items[0].projectId}
              group={group}
              locale={locale}
              rate={scope.snapshot.exchangeRate?.rate}
              history={view === "history"}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PrintProjectBlock({
  group,
  locale,
  rate,
  history,
}: {
  group: {
    project?: { name: string; date: string };
    client?: { name: string };
    items: BillingItem[];
  };
  locale: Locale;
  rate?: number;
  history: boolean;
}) {
  const { t } = useI18n();
  const estimated = group.items.some((item) => printPriceReviewState(item) !== "CONFIRMED");
  const total = sum(
    group.items.map((item) => ({
      amount: printPriceReviewState(item) === "CONFIRMED"
        ? item.amount
        : item.suggestedAmount ?? item.amount,
    })),
  );

  return (
    <section
      data-testid="printing-project-group"
      className="overflow-hidden border-y border-line bg-panel sm:rounded-2xl sm:border"
    >
      <div className="border-b border-line px-5 py-4 sm:px-6">
        <div className="flex min-w-0 items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate text-[17px] font-semibold tracking-[-0.012em]">
              {group.project?.name ?? ""}
            </h2>
            <p className="mt-1 truncate text-[12.5px] text-faint">
              {group.client?.name} · {group.project ? mediumDate(group.project.date, locale) : ""}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[10.5px] font-medium uppercase tracking-[0.06em] text-faint">
              {t(estimated ? "projects.estimatedTotal" : "projects.total")}
            </p>
            {total > 0 ? (
              <CurrencyAmount
                usd={total}
                rate={!history ? rate : undefined}
                strong
                className="mt-0.5 text-[15px]"
              />
            ) : (
              <Amount value="—" strong className="mt-0.5 block text-[15px]" />
            )}
          </div>
        </div>
      </div>
      <div className="divide-y divide-line">
        {group.items.map((item) => (
          <PrintItemCard
            key={item.id}
            item={item}
            projectName={group.project?.name}
            rate={rate}
            history={history}
          />
        ))}
      </div>
    </section>
  );
}

function PrintItemCard({
  item,
  projectName,
  rate,
  history,
}: {
  item: BillingItem;
  projectName?: string;
  rate?: number;
  history: boolean;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const review = printPriceReviewState(item);
  const suggestedUnit = item.suggestedUnitPrice ?? item.unitPrice;
  const suggestedAmount = item.suggestedAmount ?? item.amount;
  const confirmed = review === "CONFIRMED";
  const shown = confirmed ? item.amount : suggestedAmount;
  const finished = isProductionComplete(item);
  const locked = isBillingLocked(item);
  const workStatus: WorkStatus = finished
    ? "DELIVERED"
    : confirmed ? "IN_PROGRESS" : "NEEDS_REVIEW";

  return (
    <article
      data-testid="printing-item-card"
      className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 px-5 py-3.5 sm:px-6 sm:py-3"
    >
      <span className="sr-only">{projectName}</span>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <StatusPill status={workStatus} className="shrink-0" />
          <h3 className="min-w-0 truncate text-[15px] font-medium tracking-[-0.006em]">
            {t("printing.itemType")} ×{item.quantity}
          </h3>
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted">
          {item.printSize && <span className="truncate">{t("printing.size")}: {item.printSize}</span>}
          {suggestedUnit > 0 && <span className="tnum whitespace-nowrap">{money(suggestedUnit)} / pc</span>}
        </div>
      </div>

      <div className="row-span-2 flex min-w-[84px] flex-col items-end gap-1">
        {shown > 0 ? (
          <CurrencyAmount usd={shown} rate={!history ? rate : undefined} className="text-[14px]" />
        ) : (
          <span className="tnum whitespace-nowrap text-[14px] font-medium text-review">—</span>
        )}
        {shown <= 0 && <span className="whitespace-nowrap text-[11.5px] font-medium text-review">{t("printing.pricePending")}</span>}

        {!history && !locked && (
          !confirmed ? (
            <Button variant="primary" size="sm" onClick={() => setEditing(true)}>
              {t("printing.confirmPrice")}
            </Button>
          ) : (
            <ItemProductionAction item={item} size="sm" />
          )
        )}

        {history && <span className="whitespace-nowrap text-[11.5px] text-faint">{t("printing.historyReadOnly")}</span>}
        {!history && locked && <span className="whitespace-nowrap text-[11.5px] text-faint">{t("project.lockedNotice")}</span>}
      </div>

      {!locked && <PrintEditSheet item={item} open={editing} onClose={() => setEditing(false)} />}
    </article>
  );
}

function PrintEditSheet({
  item,
  open,
  onClose,
}: {
  item: BillingItem;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [size, setSize] = useState(item.printSize ?? "");
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [unitPrice, setUnitPrice] = useState(String(item.unitPrice || ""));

  const quantityValue = parseNumber(quantity);
  const unitPriceValue = parseNumber(unitPrice);
  const calculatedAmount = calculatePrintTotal(quantity, unitPrice);
  const validQuantity = quantityValue !== null && quantityValue > 0;
  const validPrice =
    validQuantity && unitPriceValue !== null && unitPriceValue > 0 && calculatedAmount !== "";

  const setPrice = async () => {
    if (
      !validQuantity ||
      unitPriceValue === null ||
      unitPriceValue <= 0 ||
      calculatedAmount === ""
    ) {
      return;
    }
    const ok = await run(
      async () => {
        await api(`/api/printing-items/${item.id}/spec`, {
          method: "PATCH",
          body: { printSize: size, quantity: quantityValue },
        });
        await api(`/api/printing-items/${item.id}/price`, {
          method: "POST",
          body: { unitPrice: unitPriceValue, amount: Number(calculatedAmount), confirm: true },
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
      title={t("printing.confirmTitle")}
      footer={
        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          <Button variant="secondary" full onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" full onClick={setPrice} disabled={busy || !validPrice}>
            {t("printing.confirmPrice")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label={t("printing.size")}>
          <Input value={size} onChange={(event) => setSize(event.target.value)} placeholder="e.g. Name Card" />
        </Field>
        <Field label={t("printing.quantity")}>
          <Input inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="tnum" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("printing.unitPrice")}>
            <Input inputMode="decimal" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} className="tnum" />
          </Field>
          <Field label={t("common.total")} hint={t("printing.autoCalculated")}>
            <Input
              value={calculatedAmount}
              readOnly
              aria-readonly="true"
              data-testid="printing-total"
              placeholder="—"
              className="tnum cursor-default bg-fill"
            />
          </Field>
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

function calculatePrintTotal(quantity: string, unitPrice: string): string {
  const quantityValue = parseNumber(quantity);
  const unitPriceValue = parseNumber(unitPrice);
  if (
    quantityValue === null ||
    quantityValue <= 0 ||
    unitPriceValue === null ||
    unitPriceValue < 0
  ) {
    return "";
  }
  return roundMoney(quantityValue * unitPriceValue).toFixed(2);
}
