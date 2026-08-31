"use client";

import { useMemo, useState } from "react";

import { ItemProductionAction } from "@/components/delivery";
import { api, useI18n } from "@/components/providers";
import { PageSkeleton, useScope } from "@/components/scope";
import { useAction } from "@/components/use-action";
import { Amount, Button, EmptyState, Field, Input, PageHeader, Sheet, StatusPill, type WorkStatus } from "@/components/ui";
import {
  isHistoricalRecord,
  isProductionComplete,
  printPriceReviewState,
} from "@/lib/derive";
import { mediumDate, money } from "@/lib/format";
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
        if (isHistoricalRecord(item)) return false;
        if (view === "review") return printPriceReviewState(item) !== "CONFIRMED";
        if (view === "ordering") {
          return printPriceReviewState(item) === "CONFIRMED" && !isProductionComplete(item);
        }
        return isProductionComplete(item);
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

  return (
    <div className="animate-rise">
      <PageHeader
        title={title}
        subtitle={
          <span>
            {subtitle}
            {view === "review" && (
              <span className="ml-2 text-review">{t("printing.reviewCount", { count: items.length })}</span>
            )}
          </span>
        }
      />

      {items.length === 0 ? (
        <EmptyState
          title={
            view === "review"
              ? t("printing.emptyReview")
              : view === "ordering"
                ? t("printing.emptyOrdering")
                : view === "delivered"
                  ? t("printing.emptyDelivered")
                  : t("printing.emptyHistory")
          }
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
  const { run, busy } = useAction();
  const [editing, setEditing] = useState(false);
  const review = printPriceReviewState(item);
  const suggestedUnit = item.suggestedUnitPrice ?? item.unitPrice;
  const suggestedAmount = item.suggestedAmount ?? item.amount;
  const confirmed = review === "CONFIRMED";
  const finished = isProductionComplete(item);
  const workStatus: WorkStatus = finished
    ? "DELIVERED"
    : review === "REVIEW_REQUIRED"
      ? "NEEDS_REVIEW"
      : "IN_PROGRESS";

  const confirm = async () => {
    await run(
      () =>
        api(`/api/printing-items/${item.id}/price`, {
          method: "POST",
          body: {
            unitPrice: item.unitPrice,
            amount: item.amount,
            confirm: true,
            priceSource: item.priceSource,
            priceReason: item.priceReason,
          },
        }),
      { key: "toast.itemUpdated" },
    );
  };

  return (
    <article
      data-testid="printing-item-card"
      className="overflow-hidden border-y border-line bg-panel sm:rounded-2xl sm:border"
    >
      <div className="px-5 py-5 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <StatusPill status={workStatus} />
          <span className="shrink-0 text-right">
            <span className="block text-[11px] font-medium uppercase tracking-[0.08em] text-faint">
              {confirmed ? t("printing.confirmed") : t("printing.suggested")}
            </span>
            <Amount
              value={
                (confirmed ? item.amount : suggestedAmount) > 0
                  ? money(confirmed ? item.amount : suggestedAmount)
                  : t("printing.pricePending")
              }
              className="mt-1 block text-[15px] font-semibold"
            />
          </span>
        </div>

        <div className="mt-3 min-w-0">
          <h2 className="truncate text-[17px] font-semibold tracking-[-0.012em]">
            {project?.name ?? ""}
          </h2>
          <p className="mt-1 truncate text-[12.5px] text-faint">
            {client?.name} · {project ? mediumDate(project.date, locale) : ""}
          </p>
          <p className="mt-3 truncate text-[15px] font-medium tracking-[-0.006em]">
            {item.description} · PRINT ×{item.quantity}
          </p>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 border-t border-line pt-4 sm:grid-cols-4">
          <Info label={t("printing.size")} value={item.printSize || "—"} />
          <Info label={t("printing.quantity")} value={String(item.quantity)} numeric />
          <Info
            label={confirmed ? t("printing.confirmed") : t("printing.suggested")}
            value={
              (confirmed ? item.amount : suggestedAmount) > 0
                ? money(confirmed ? item.amount : suggestedAmount)
                : t("printing.pricePending")
            }
            emphasis={!confirmed}
            numeric={suggestedAmount > 0}
          />
          <Info
            label={t("printing.unitPrice")}
            value={suggestedUnit > 0 ? `${money(suggestedUnit)} / pc` : "—"}
            numeric={suggestedUnit > 0}
          />
        </div>

        <div className="mt-5 space-y-2 border-t border-line pt-4 text-[13px]">
          {item.priceSource && (
            <p className="text-muted">
              <span className="text-faint">{t("printing.priceSource")}:</span> {item.priceSource}
            </p>
          )}
          {item.priceReason && (
            <p className="leading-relaxed text-muted">
              <span className="text-faint">{t("printing.reason")}:</span> {item.priceReason}
            </p>
          )}
          {item.note && (
            <p className="leading-relaxed text-muted">
              <span className="text-faint">{t("printing.note")}:</span> {item.note}
            </p>
          )}
          {item.priceConfirmedBy && (
            <p className="text-faint">
              {t("printing.confirmedBy", { name: item.priceConfirmedBy })}
            </p>
          )}
        </div>
      </div>

      {!history && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3.5 sm:px-6">
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)} disabled={busy}>
            {t("printing.editSpec")}
          </Button>
          {!confirmed && (
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)} disabled={busy}>
              {t("printing.editPrice")}
            </Button>
          )}
          {!confirmed ? (
            <Button variant="primary" size="sm" onClick={confirm} disabled={busy || item.amount <= 0}>
              {t("printing.confirmPrice")}
            </Button>
          ) : !finished ? (
            <ItemProductionAction item={item} size="sm" />
          ) : null}
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
  const [amount, setAmount] = useState(String(item.amount || ""));
  const [source, setSource] = useState(item.priceSource ?? "");
  const [reason, setReason] = useState(item.priceReason ?? "");
  const [note, setNote] = useState(item.note ?? "");

  const saveSpec = async () => {
    const ok = await run(
      () =>
        api(`/api/printing-items/${item.id}/spec`, {
          method: "PATCH",
          body: { printSize: size, quantity: Number(quantity), note },
        }),
      { key: "toast.itemUpdated" },
    );
    if (ok) onClose();
  };

  const savePrice = async (confirm: boolean) => {
    const ok = await run(
      () =>
        api(`/api/printing-items/${item.id}/price`, {
          method: "POST",
          body: {
            unitPrice: Number(unitPrice),
            amount: Number(amount),
            confirm,
            priceSource: source,
            priceReason: reason,
          },
        }),
      { key: "toast.itemUpdated" },
    );
    if (ok) onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("printing.specEdit")}
      description={t("printing.confirmHint")}
      footer={
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Button variant="secondary" full onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" full onClick={saveSpec} disabled={busy}>
              {t("printing.saveSpec")}
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" full onClick={() => savePrice(false)} disabled={busy}>
              {t("printing.savePrice")}
            </Button>
            <Button variant="primary" full onClick={() => savePrice(true)} disabled={busy}>
              {t("printing.confirmPrice")}
            </Button>
          </div>
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
          <Field label={t("common.total")}>
            <Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className="tnum" />
          </Field>
        </div>
        <Field label={t("printing.priceSource")} hint={t("common.optional")}>
          <Input value={source} onChange={(event) => setSource(event.target.value)} placeholder="Historical / Pricing DB / AI" />
        </Field>
        <Field label={t("printing.reason")} hint={t("common.optional")}>
          <Input value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
        <Field label={t("printing.note")} hint={t("common.optional")}>
          <Input value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}
