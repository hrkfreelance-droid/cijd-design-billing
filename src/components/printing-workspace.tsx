"use client";

import { useMemo, useState } from "react";

import { ItemProductionAction } from "@/components/delivery";
import { api, useI18n } from "@/components/providers";
import { PageSkeleton, useScope } from "@/components/scope";
import { useAction } from "@/components/use-action";
import { Button, EmptyState, Field, Input, PageHeader, PageTotal, Sheet, StatusPill, type WorkStatus } from "@/components/ui";
import {
  isHistoricalRecord,
  isProductionComplete,
  printPriceReviewState,
} from "@/lib/derive";
import { mediumDate, money, roundMoney } from "@/lib/format";
import type { BillingItem } from "@/lib/types";

export type PrintingView = "review" | "ordering" | "delivered" | "history";

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

  if (!scope) return <PageSkeleton />;

  const title =
    view === "review"
      ? t("printing.title")
      : view === "ordering"
        ? t("printing.orderingTitle")
        : view === "delivered"
          ? t("printing.deliveredTitle")
          : t("printing.historyTitle");
  const subtitle =
    view === "review"
      ? t("printing.reviewSubtitle")
      : view === "ordering"
        ? t("printing.orderingSubtitle")
        : view === "delivered"
          ? t("printing.deliveredSubtitle")
          : t("printing.historySubtitle");
  const knownTotal = roundMoney(items.reduce((total, item) => total + Math.max(item.amount, 0), 0));
  const totalLabel =
    view === "history"
      ? t("projects.knownTotal")
      : items.some((item) => printPriceReviewState(item) !== "CONFIRMED")
        ? t("projects.estimatedTotal")
        : undefined;

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
        action={<PageTotal value={knownTotal > 0 ? money(knownTotal) : "—"} label={totalLabel} />}
      />

      {items.length === 0 ? (
        <EmptyState
          title={view === "history" ? t("printing.emptyHistory") : t("printing.emptyReview")}
        />
      ) : (
        <div className="space-y-4 px-5 pb-10 sm:px-8">
          {items.map((item) => (
            <PrintItemCard
              key={item.id}
              item={item}
              project={scope.idx.projectById.get(item.projectId)}
              client={scope.clientOf(item.projectId)}
              locale={locale}
              history={view === "history"}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PrintItemCard({
  item,
  project,
  client,
  locale,
  history,
}: {
  item: BillingItem;
  project?: { name: string; date: string };
  client?: { name: string };
  locale: "ja" | "en";
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
  const workStatus: WorkStatus = finished
    ? "DELIVERED"
    : confirmed ? "IN_PROGRESS" : "NEEDS_REVIEW";

  return (
    <article
      data-testid="printing-item-card"
      className="overflow-hidden border-y border-line bg-panel sm:rounded-2xl sm:border"
    >
      <div className="px-5 py-5 sm:px-6">
        <div className="mt-3 min-w-0">
          <h2 className="truncate text-[17px] font-semibold tracking-[-0.012em]">
            {project?.name ?? ""}
          </h2>
          <p className="mt-1 truncate text-[12.5px] text-faint">
            {client?.name} · {project ? mediumDate(project.date, locale) : ""}
          </p>
          <p className="mt-3 truncate text-[15px] font-medium tracking-[-0.006em]">
            {t("printing.itemType")} ×{item.quantity}
          </p>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 border-t border-line pt-4 sm:grid-cols-3">
          {item.printSize && <Info label={t("printing.size")} value={item.printSize} />}
          {suggestedUnit > 0 && (
            <Info label={t("printing.unitPrice")} value={`${money(suggestedUnit)} / pc`} numeric />
          )}
          <Info
            label={t("common.amount")}
            value={shown > 0 ? money(shown) : t("printing.pricePending")}
            emphasis={shown <= 0}
            numeric={shown > 0}
          />
          <StatusPill status={workStatus} className="justify-self-start" />
        </div>
      </div>

      {!history && (
        <div className="flex min-w-0 items-center justify-end border-t border-line px-5 py-3.5 sm:px-6">
          {!confirmed ? (
            <Button variant="primary" size="sm" onClick={() => setEditing(true)}>
              {t("printing.confirmPrice")}
            </Button>
          ) : (
            <ItemProductionAction item={item} size="sm" />
          )}
        </div>
      )}

      {history && (
        <div className="border-t border-line px-5 py-3.5 text-[12.5px] text-faint sm:px-6">
          {t("printing.historyReadOnly")}
        </div>
      )}

      <PrintEditSheet item={item} open={editing} onClose={() => setEditing(false)} />
    </article>
  );
}

function Info({
  label,
  value,
  emphasis = false,
  numeric = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  numeric?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-[0.07em] text-faint">{label}</p>
      <p className={`mt-1 truncate text-[14px] ${emphasis ? "font-medium text-review" : "text-text"} ${numeric ? "tnum" : ""}`}>
        {value}
      </p>
    </div>
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
