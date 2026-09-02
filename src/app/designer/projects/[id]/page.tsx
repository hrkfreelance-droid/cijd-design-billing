"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useState } from "react";

import { BillingItemCard } from "@/components/billing-item-card";
import { ItemProductionAction } from "@/components/delivery";
import { ChevronRight, PlusIcon } from "@/components/icons";
import { api, useI18n } from "@/components/providers";
import { PageSkeleton, useScope } from "@/components/scope";
import { useAction } from "@/components/use-action";
import {
  Amount,
  Button,
  ConfirmSheet,
  Field,
  Input,
  PageTotal,
  Select,
  Sheet,
  StatusTag,
} from "@/components/ui";
import {
  flowStatus,
  isBillingLocked,
  isHistoricalRecord,
  isOperationalRecord,
  priceState,
  sum,
} from "@/lib/derive";
import { formatKhr } from "@/lib/exchange-rate";
import { mediumDate, money } from "@/lib/format";
import { ITEM_TYPES, type BillingItem, type ItemType } from "@/lib/types";

export default function ProjectPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const scope = useScope();
  const { t, locale } = useI18n();
  const [editing, setEditing] = useState<BillingItem | null>(null);
  const [adding, setAdding] = useState(false);
  const historyView = searchParams.get("view") === "history";
  const readyView = searchParams.get("from") === "ready";

  if (!scope) return <PageSkeleton />;

  const project = scope.snapshot.projects.find((candidate) => candidate.id === params.id);
  if (!project) {
    return (
      <div className="px-5 pt-16 text-center sm:px-8">
        <p className="text-[14px] text-muted">{t("project.notFound")}</p>
        <Link
          href="/designer/projects"
          className="mt-3 inline-block text-[13px] font-medium text-accent hover:underline"
        >
          {t("projects.title")}
        </Link>
      </div>
    );
  }

  const client = scope.idx.clientById.get(project.clientId);
  const items = (scope.idx.itemsByProject.get(project.id) ?? [])
    .filter(historyView ? isHistoricalRecord : isOperationalRecord)
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const hasSuggested = items.some((item) => priceState(item) === "SUGGESTED");
  const projectTotal = sum(items.filter((item) => item.amount > 0));
  const exchangeRate = scope.snapshot.exchangeRate;
  const backHref = historyView
    ? "/designer/archive"
    : readyView
      ? "/designer/delivered"
      : "/designer/projects";
  const backLabel = historyView
    ? t("productionArchive.title")
    : readyView
      ? t("delivered.title")
      : t("projects.title");

  return (
    <div className="animate-rise">
      <div className="px-5 pt-3 sm:px-8 sm:pt-5">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-[13px] text-muted transition-colors hover:text-text"
        >
          <ChevronRight className="h-3.5 w-3.5 rotate-180" />
          {backLabel}
        </Link>
      </div>

      <div className="flex items-start justify-between gap-6 px-5 pb-3 pt-1.5 sm:px-8">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.021em] sm:text-[30px]">
            {project.name}
          </h1>
          <p className="mt-1 text-[13.5px] text-muted">
            {client?.name} · {mediumDate(project.date, locale)} ·{" "}
            {historyView ? t("productionArchive.historyLabel") : project.createdBy}
          </p>
        </div>
        <PageTotal
          value={projectTotal > 0 ? money(projectTotal) : "—"}
          label={t(hasSuggested ? "projects.estimatedTotal" : "project.total")}
          secondaryValue={exchangeRate && projectTotal > 0 ? formatKhr(projectTotal, exchangeRate.rate) : undefined}
          secondaryLabel={exchangeRate && projectTotal > 0 ? t("currency.rate", { rate: exchangeRate.rate }) : undefined}
          rate={exchangeRate?.rate}
          rateEffectiveDate={exchangeRate?.effectiveDate}
          rateFetchedAt={scope.snapshot.exchangeRateLastCheckedAt}
        />
      </div>

      {/* Historical imports are evidence, not editable production work. The
          notice earns a panel; the everyday hint is just a caption. */}
      {historyView ? (
        <div className="border-y border-line bg-fill px-5 py-3.5 sm:mx-8 sm:rounded-xl sm:border sm:px-5">
          <p className="text-[13px] leading-relaxed text-muted">
            {t("productionArchive.historyNotice")}
          </p>
        </div>
      ) : (
        <p className="px-5 text-[12.5px] leading-relaxed text-faint sm:px-8">
          {items.length ? t("projects.itemActionsHint") : t("delivery.needsItems")}
        </p>
      )}

      <div className="mt-2 divide-y divide-line border-y border-line bg-panel px-5 sm:mx-8 sm:rounded-2xl sm:border sm:px-6">
        {items.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-[14px] text-muted">{t("project.noItems")}</p>
            <p className="mt-1 text-[13px] text-faint">{t("project.noItemsHint")}</p>
          </div>
        ) : (
          items.map((item) => (
            <BillingItemCard
              key={item.id}
              item={item}
              projectId={project.id}
              history={historyView}
              onOpen={historyView ? undefined : () => setEditing(item)}
            />
          ))
        )}

        {!historyView && (
          <button
            onClick={() => setAdding(true)}
            className="flex w-full items-center gap-2 py-2.5 text-left text-[14.5px] font-medium text-accent transition-colors duration-150 hover:text-accent-hover"
          >
            <PlusIcon className="h-4 w-4" />
            {t("project.addItem")}
          </button>
        )}
      </div>

      <ItemSheet
        key={editing?.id ?? "new"}
        open={adding || editing !== null}
        item={editing}
        projectId={project.id}
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
      />
    </div>
  );
}

function ItemSheet({
  open,
  item,
  projectId,
  onClose,
}: {
  open: boolean;
  item: BillingItem | null;
  projectId: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [description, setDescription] = useState(item?.description ?? "");
  const [type, setType] = useState<ItemType>(item?.type ?? "DESIGN");
  const [quantity, setQuantity] = useState(String(item?.quantity ?? 1));
  const [unitPrice, setUnitPrice] = useState(String(item?.unitPrice ?? ""));
  const [custom, setCustom] = useState(item?.customAmount ?? false);
  const [typedAmount, setTypedAmount] = useState(String(item?.amount ?? ""));
  const [note, setNote] = useState(item?.note ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const locked = !!item && isBillingLocked(item);
  const computed =
    Math.round((Number(quantity) || 0) * (Number(unitPrice) || 0) * 100) / 100;
  // The amount follows qty x unit price until someone types over it.
  const amount = custom ? typedAmount : String(computed);

  const payload = () => ({
    description,
    type,
    quantity: Number(quantity) || 0,
    unitPrice: Number(unitPrice) || 0,
    amount: custom ? Number(amount) || 0 : null,
    confirmPrice: !!item,
    note,
  });

  const save = async () => {
    if (!description.trim()) return;
    const ok = await run(
      async () => {
        if (item) {
          await api(`/api/billing-items/${item.id}`, { method: "PATCH", body: payload() });
        } else {
          await api("/api/billing-items", {
            method: "POST",
            body: { projectId, ...payload(), amount: custom ? Number(amount) || 0 : undefined },
          });
        }
      },
      { key: item ? "toast.itemUpdated" : "toast.itemAdded" },
    );
    if (ok) onClose();
  };

  const changeStatus = async (billingStatus: BillingItem["billingStatus"]) => {
    if (!item) return;
    const ok = await run(
      async () => {
        await api(`/api/billing-items/${item.id}`, { method: "PATCH", body: payload() });
        await api(`/api/billing-items/${item.id}`, { method: "PATCH", body: { billingStatus } });
      },
      { key: "toast.itemUpdated" },
    );
    if (ok) onClose();
  };

  const remove = async () => {
    if (!item) return;
    const ok = await run(
      () => api(`/api/billing-items/${item.id}`, { method: "DELETE" }),
      { key: "toast.itemRemoved" },
    );
    setConfirmDelete(false);
    if (ok) onClose();
  };

  if (locked && item) {
    return (
      <Sheet
        open={open}
        onClose={onClose}
        title={item.description}
        footer={
          <Button variant="secondary" full onClick={onClose}>
            {t("common.close")}
          </Button>
        }
      >
        <div className="space-y-3 pb-2">
          <SummaryRow label={t("common.status")}>
            <StatusTag status={flowStatus(item)} />
          </SummaryRow>
          <SummaryRow label={t("item.type")}>{t(`type.${item.type}`)}</SummaryRow>
          <SummaryRow label={t("item.quantity")}>
            <span className="tnum">
              {item.quantity} × {money(item.unitPrice)}
            </span>
          </SummaryRow>
          <SummaryRow label={t("item.amount")}>
            <Amount value={money(item.amount)} strong />
          </SummaryRow>
          <p className="rounded-xl bg-fill px-3.5 py-3 text-[13px] leading-relaxed text-muted">
            {t("project.lockedNotice")}
          </p>
        </div>
      </Sheet>
    );
  }

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={item ? t("item.edit") : t("item.new")}
        footer={
          <div className="grid min-w-0 gap-2 sm:grid-cols-2">
            <Button variant="secondary" full onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              full
              onClick={save}
              disabled={!description.trim() || busy}
            >
              {t("common.save")}
            </Button>
          </div>
        }
      >
        <div className="space-y-4 pb-2">
          {item && <PriceContext item={item} />}

          <Field label={t("item.description")}>
            <Input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t("item.descriptionPlaceholder")}
            />
          </Field>

          <Field label={t("item.type")}>
            <Select value={type} onChange={(event) => setType(event.target.value as ItemType)}>
              {ITEM_TYPES.map((value) => (
                <option key={value} value={value}>
                  {t(`type.${value}`)}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("item.quantity")}>
              <Input
                inputMode="decimal"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                className="tnum"
              />
            </Field>
            <Field label={t("item.unitPrice")}>
              <Input
                inputMode="decimal"
                value={unitPrice}
                onChange={(event) => setUnitPrice(event.target.value)}
                placeholder="0"
                className="tnum"
              />
            </Field>
          </div>

          <Field label={t("item.amount")} hint={custom ? undefined : t("item.calculated")}>
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(event) => {
                setCustom(true);
                setTypedAmount(event.target.value);
              }}
              className="tnum"
            />
          </Field>
          {custom && (
            <button
              onClick={() => setCustom(false)}
              className="-mt-2 text-[12.5px] text-accent hover:underline"
            >
              {t("item.useCalculated")}
            </button>
          )}

          <Field label={t("item.note")} hint={t("common.optional")}>
            <Input value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>

          {item && (
            <div className="space-y-2 border-t border-line pt-4">
              <ItemProductionAction item={item} size="md" full onDone={onClose} />
              {item.billingStatus !== "NEEDS_REVIEW" ? (
                <Button full onClick={() => changeStatus("NEEDS_REVIEW")} disabled={busy}>
                  {t("item.markReview")}
                </Button>
              ) : (
                <Button full onClick={() => changeStatus("NOT_READY")} disabled={busy}>
                  {t("item.markInProgress")}
                </Button>
              )}
              <button
                onClick={() => setConfirmDelete(true)}
                className="mt-1 block w-full py-2 text-center text-[13px] text-faint transition-colors hover:text-review"
              >
                {t("item.delete")}
              </button>
            </div>
          )}
        </div>
      </Sheet>

      <ConfirmSheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        title={t("item.delete")}
        message={t("item.deleteConfirm")}
        confirmLabel={t("item.delete")}
        busy={busy}
      />
    </>
  );
}

/**
 * Why this amount is not final yet. The figure, where it came from and the
 * reasoning already exist on the record; showing them here is what turns
 * "Needs review" from a label into something the designer can act on.
 */
function PriceContext({ item }: { item: BillingItem }) {
  const { t } = useI18n();
  const state = priceState(item);
  if (state === "CONFIRMED") return null;

  const suggested = item.suggestedAmount ?? item.amount;
  const unit = item.suggestedUnitPrice ?? item.unitPrice;

  return (
    <div className="rounded-xl bg-review/8 px-3.5 py-3">
      <p className="text-[12.5px] font-medium text-review">
        {state === "PENDING"
          ? `${t("projects.pricePending")} · ${t("projects.priceReview")}`
          : `${t("projects.priceSuggested", { amount: money(suggested) })} · ${t("projects.priceReview")}`}
      </p>
      <dl className="mt-2 space-y-1 text-[12.5px] text-muted">
        {item.printSize && (
          <ContextRow label={t("printing.size")} value={item.printSize} />
        )}
        {unit > 0 && (
          <ContextRow label={t("printing.unitPrice")} value={`${money(unit)} / pc`} />
        )}
        {item.priceSource && (
          <ContextRow label={t("printing.priceSource")} value={item.priceSource} />
        )}
        {item.priceReason && (
          <ContextRow label={t("printing.reason")} value={item.priceReason} />
        )}
      </dl>
      {item.type === "PRINT" && (
        <p className="mt-2 text-[12px] leading-relaxed text-faint">
          {t("printing.confirmedInPrinting")}
        </p>
      )}
    </div>
  );
}

function ContextRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-faint">{label}</dt>
      <dd className="min-w-0 flex-1 leading-relaxed">{value}</dd>
    </div>
  );
}

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line pb-3 text-[14px] last:border-0">
      <span className="text-muted">{label}</span>
      <span>{children}</span>
    </div>
  );
}
