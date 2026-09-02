"use client";

import { useMemo, useState } from "react";

import { BillingItemCard } from "@/components/billing-item-card";
import { ItemProductionAction } from "@/components/delivery";
import { PlusIcon } from "@/components/icons";
import { api, useI18n } from "@/components/providers";
import { useScope } from "@/components/scope";
import { useAction } from "@/components/use-action";
import {
  Amount,
  Button,
  ConfirmSheet,
  Field,
  Input,
  Select,
  Sheet,
  StatusTag,
} from "@/components/ui";
import {
  flowStatus,
  isBillingLocked,
  isOperationalRecord,
  priceState,
  sum,
} from "@/lib/derive";
import { mediumDate, money, roundMoney } from "@/lib/format";
import { suggestedPrintBillingTotal } from "@/lib/print-pricing";
import { ITEM_TYPES, type BillingItem, type ItemType } from "@/lib/types";

export function ProjectEditorModal({
  projectId,
  open,
  onClose,
}: {
  projectId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const scope = useScope();
  const { t, locale } = useI18n();
  const [editing, setEditing] = useState<BillingItem | null>(null);
  const [adding, setAdding] = useState(false);

  const project = projectId ? scope?.idx.projectById.get(projectId) : undefined;
  const client = project ? scope?.idx.clientById.get(project.clientId) : undefined;
  const items = useMemo(
    () =>
      project && scope
        ? (scope.idx.itemsByProject.get(project.id) ?? [])
            .filter(isOperationalRecord)
            .slice()
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        : [],
    [project, scope],
  );

  if (!project) return null;

  const total = sum(items.filter((item) => item.amount > 0));
  const estimated = items.some((item) => priceState(item) !== "CONFIRMED");
  const close = () => {
    setEditing(null);
    setAdding(false);
    onClose();
  };

  return (
    <>
      <Sheet
        open={open}
        onClose={close}
        title={project.name}
        description={`${client?.name ?? ""} · ${mediumDate(project.date, locale)} · ${project.createdBy}`}
        footer={
          <Button variant="secondary" full onClick={close}>
            {t("common.close")}
          </Button>
        }
      >
        <div className="pb-2">
          <div className="mb-3 flex items-end justify-between gap-4 rounded-xl bg-fill px-3.5 py-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.07em] text-faint">
                {estimated ? t("projects.estimatedTotal") : t("project.total")}
              </p>
              <p className="mt-0.5 text-[12px] text-muted">
                {items.length} {items.length === 1 ? "item" : "items"}
              </p>
            </div>
            <Amount value={total > 0 ? money(total) : "—"} strong className="text-[20px]" />
          </div>

          <div className="divide-y divide-line">
            {items.map((item) => (
              <BillingItemCard
                key={item.id}
                item={item}
                projectId={project.id}
                onOpen={() => setEditing(item)}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-1 flex min-h-11 w-full items-center gap-2 rounded-xl px-2 text-left text-[14px] font-medium text-accent transition-colors hover:bg-fill"
          >
            <PlusIcon className="h-4 w-4" />
            {t("project.addItem")}
          </button>
        </div>
      </Sheet>

      <ProjectItemSheet
        key={editing?.id ?? (adding ? "new" : "closed")}
        open={adding || editing !== null}
        item={editing}
        projectId={project.id}
        onClose={() => {
          setEditing(null);
          setAdding(false);
        }}
      />
    </>
  );
}

function ProjectItemSheet({
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
  const { t, locale } = useI18n();
  const { run, runResult, busy } = useAction();
  const [description, setDescription] = useState(item?.description ?? "");
  const [type, setType] = useState<ItemType>(item?.type ?? "DESIGN");
  const [quantity, setQuantity] = useState(String(item?.quantity ?? 1));
  const [unitPrice, setUnitPrice] = useState(String(item?.unitPrice || ""));
  const [typedAmount, setTypedAmount] = useState(String(item?.amount || ""));
  const [custom, setCustom] = useState(item?.customAmount ?? false);
  const [printSize, setPrintSize] = useState(item?.printSize ?? "");
  const [costUnit, setCostUnit] = useState(String(item?.printCostUnitPrice || ""));
  // Auto-priced print items keep following the suggestion. Only show a value
  // here when somebody has already deliberately overridden the final price.
  const [finalBilling, setFinalBilling] = useState(
    item?.type === "PRINT" && item.billingPriceManual ? String(item.amount) : "",
  );
  const [note, setNote] = useState(item?.note ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const locked = !!item && isBillingLocked(item);
  const qty = positiveNumber(quantity);
  const ordinaryComputed = roundMoney((qty ?? 0) * (positiveNumber(unitPrice) ?? 0));
  const ordinaryAmount = custom ? Number(typedAmount) || 0 : ordinaryComputed;
  const costUnitValue = positiveNumber(costUnit);
  const printCostTotal = qty && costUnitValue ? roundMoney(qty * costUnitValue) : 0;
  const calculatedSuggested = printCostTotal > 0
    ? suggestedPrintBillingTotal(printCostTotal)
    : item?.suggestedAmount ?? 0;
  const finalBillingValue = positiveNumber(finalBilling);
  const isPrint = type === "PRINT";

  const save = async () => {
    if (!description.trim() || !qty) return;

    if (!isPrint) {
      const body = {
        description,
        type,
        quantity: qty,
        unitPrice: Number(unitPrice) || 0,
        amount: custom ? ordinaryAmount : null,
        confirmPrice: !!item,
        note,
      };
      const ok = await run(
        () =>
          item
            ? api(`/api/billing-items/${item.id}`, { method: "PATCH", body })
            : api("/api/billing-items", { method: "POST", body: { projectId, ...body } }),
        { key: item ? "toast.itemUpdated" : "toast.itemAdded" },
      );
      if (ok) onClose();
      return;
    }

    const result = await runResult<BillingItem>(async () => {
      let current: BillingItem;
      if (item) {
        if (item.type !== "PRINT") {
          current = await api<BillingItem>(`/api/billing-items/${item.id}`, {
            method: "PATCH",
            body: {
              description,
              type: "PRINT",
              quantity: qty,
              unitPrice: 0,
              amount: 0,
              printSize,
              note,
            },
          });
        } else {
          current = await api<BillingItem>(`/api/printing-items/${item.id}/spec`, {
            method: "PATCH",
            body: { description, printSize, quantity: qty, note },
          });
        }
      } else {
        current = await api<BillingItem>("/api/billing-items", {
          method: "POST",
          body: {
            projectId,
            description,
            type: "PRINT",
            quantity: qty,
            unitPrice: 0,
            amount: 0,
            printSize,
            note,
          },
        });
      }

      if (costUnitValue && printCostTotal > 0) {
        current = await api<BillingItem>(`/api/printing-items/${current.id}/price`, {
          method: "POST",
          body: {
            unitPrice: costUnitValue,
            amount: printCostTotal,
            confirm: true,
          },
        });
      }

      if (finalBillingValue && finalBillingValue > 0) {
        const suggested = current.suggestedAmount ?? calculatedSuggested;
        const shouldOverride =
          current.billingPriceManual ||
          roundMoney(finalBillingValue) !== roundMoney(suggested || 0);
        if (shouldOverride) {
          current = await api<BillingItem>(`/api/billing-items/${current.id}/billing-price`, {
            method: "POST",
            body: { amount: finalBillingValue },
          });
        }
      }
      return current;
    }, { key: item ? "toast.itemUpdated" : "toast.itemAdded" });

    if (result) onClose();
  };

  const changeStatus = async (billingStatus: BillingItem["billingStatus"]) => {
    if (!item) return;
    const ok = await run(
      () => api(`/api/billing-items/${item.id}`, { method: "PATCH", body: { billingStatus } }),
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
        footer={<Button variant="secondary" full onClick={onClose}>{t("common.close")}</Button>}
      >
        <div className="space-y-3 pb-2">
          <SummaryRow label={t("common.status")}><StatusTag status={flowStatus(item)} /></SummaryRow>
          <SummaryRow label={t("item.type")}>{t(`type.${item.type}`)}</SummaryRow>
          {item.type === "PRINT" && item.printCostAmount != null && (
            <SummaryRow label={copy(locale, "印刷原価", "Print cost")}><Amount value={money(item.printCostAmount)} /></SummaryRow>
          )}
          {item.type === "PRINT" && item.suggestedAmount != null && (
            <SummaryRow label={copy(locale, "推奨請求", "Suggested billing")}><Amount value={money(item.suggestedAmount)} /></SummaryRow>
          )}
          <SummaryRow label={copy(locale, "最終請求", "Final billing")}><Amount value={money(item.amount)} strong /></SummaryRow>
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
            <Button variant="secondary" full onClick={onClose}>{t("common.cancel")}</Button>
            <Button variant="primary" full onClick={save} disabled={!description.trim() || !qty || busy}>
              {t("common.save")}
            </Button>
          </div>
        }
      >
        <div className="space-y-4 pb-2">
          <Field label={t("item.description")}>
            <Input value={description} onChange={(event) => setDescription(event.target.value)} />
          </Field>
          <Field label={t("item.type")}>
            <Select value={type} onChange={(event) => setType(event.target.value as ItemType)}>
              {ITEM_TYPES.map((value) => <option key={value} value={value}>{t(`type.${value}`)}</option>)}
            </Select>
          </Field>

          {isPrint ? (
            <>
              <Field label={copy(locale, "印刷サイズ / 仕様", "Print size / spec")}>
                <Input value={printSize} onChange={(event) => setPrintSize(event.target.value)} placeholder="e.g. A4 / Name Card" />
              </Field>
              <Field label={t("item.quantity")}>
                <Input inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="tnum" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={copy(locale, "原価 / 1個", "Cost / unit")}>
                  <Input inputMode="decimal" value={costUnit} onChange={(event) => setCostUnit(event.target.value)} placeholder="0" className="tnum" />
                </Field>
                <Field label={copy(locale, "原価合計", "Cost total")}>
                  <Input value={printCostTotal > 0 ? printCostTotal.toFixed(2) : ""} readOnly placeholder="—" className="tnum cursor-default bg-fill" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3 rounded-xl bg-fill px-3.5 py-3">
                <div>
                  <p className="text-[11.5px] text-faint">{copy(locale, "推奨請求", "Suggested billing")}</p>
                  <Amount value={calculatedSuggested > 0 ? money(calculatedSuggested) : "—"} strong className="mt-1 block text-[16px]" />
                  <p className="mt-1 text-[10.5px] leading-snug text-faint">
                    {copy(locale, "利益を載せて5/10単位に切り上げ", "Margin applied, rounded up to 5/10")}
                  </p>
                </div>
                <Field label={copy(locale, "最終請求", "Final billing")}>
                  <Input
                    inputMode="decimal"
                    value={finalBilling}
                    onChange={(event) => setFinalBilling(event.target.value)}
                    placeholder={calculatedSuggested > 0 ? String(calculatedSuggested) : "—"}
                    className="tnum bg-panel"
                  />
                </Field>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("item.quantity")}>
                  <Input inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="tnum" />
                </Field>
                <Field label={t("item.unitPrice")}>
                  <Input inputMode="decimal" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} className="tnum" />
                </Field>
              </div>
              <Field label={t("item.amount")} hint={custom ? undefined : t("item.calculated")}>
                <Input
                  inputMode="decimal"
                  value={custom ? typedAmount : String(ordinaryComputed)}
                  onChange={(event) => { setCustom(true); setTypedAmount(event.target.value); }}
                  className="tnum"
                />
              </Field>
              {custom && (
                <button type="button" onClick={() => setCustom(false)} className="-mt-2 text-[12.5px] text-accent hover:underline">
                  {t("item.useCalculated")}
                </button>
              )}
            </>
          )}

          <Field label={t("item.note")} hint={t("common.optional")}>
            <Input value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>

          {item && (
            <div className="space-y-2 border-t border-line pt-4">
              <ItemProductionAction item={item} size="md" full onDone={onClose} />
              {item.billingStatus !== "NEEDS_REVIEW" ? (
                <Button full onClick={() => changeStatus("NEEDS_REVIEW")} disabled={busy}>{t("item.markReview")}</Button>
              ) : (
                <Button full onClick={() => changeStatus("NOT_READY")} disabled={busy}>{t("item.markInProgress")}</Button>
              )}
              <button type="button" onClick={() => setConfirmDelete(true)} className="block w-full py-2 text-center text-[13px] text-faint transition-colors hover:text-review">
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

function positiveNumber(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function copy(locale: string, ja: string, en: string) {
  return locale === "ja" ? ja : en;
}

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line py-2.5 last:border-b-0">
      <span className="text-[12.5px] text-muted">{label}</span>
      <span className="min-w-0 text-right text-[13.5px]">{children}</span>
    </div>
  );
}
