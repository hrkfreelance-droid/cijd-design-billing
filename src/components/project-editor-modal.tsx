"use client";

import { useMemo, useState } from "react";

import { BillingItemCard } from "@/components/billing-item-card";
import { ItemProductionAction } from "@/components/delivery";
import { PlusIcon } from "@/components/icons";
import { api, useI18n } from "@/components/providers";
import { useScope } from "@/components/scope";
import { useAction } from "@/components/use-action";
import { useLinkedAmounts } from "@/components/use-linked-amounts";
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
import { ITEM_TYPES, type BillingItem, type ItemType, type Project } from "@/lib/types";

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
        footer={<Button variant="secondary" full onClick={close}>{t("common.close")}</Button>}
      >
        <div className="space-y-4 pb-2">
          <ProjectNameEditor key={`${project.id}:${project.name}`} project={project} />

          <div className="flex items-center justify-between gap-4 border-y border-line py-3">
            <div>
              <p className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-faint">
                {estimated ? t("projects.estimatedTotal") : t("project.total")}
              </p>
              <p className="mt-1 text-[12px] text-muted">{items.length} {items.length === 1 ? "item" : "items"}</p>
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
                showActions={false}
              />
            ))}
          </div>

          <Button type="button" variant="secondary" full onClick={() => setAdding(true)} className="!h-11">
            <PlusIcon className="h-4 w-4" />
            {t("project.addItem")}
          </Button>
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

function ProjectNameEditor({ project }: { project: Project }) {
  const { locale } = useI18n();
  const { run, busy } = useAction();
  const [name, setName] = useState(project.name);
  const trimmed = name.trim();
  const changed = trimmed.length > 0 && trimmed !== project.name;

  const save = async () => {
    if (!changed) return;
    await run(() =>
      api(`/api/projects/${project.id}`, {
        method: "PATCH",
        body: { name: trimmed },
      }),
    );
  };

  return (
    <div className="space-y-2 rounded-2xl border border-line bg-fill/40 p-3.5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] font-medium text-muted">{copy(locale, "案件タイトル", "Project title")}</p>
        {changed && <span className="text-[11px] text-faint">{copy(locale, "未保存", "Unsaved")}</span>}
      </div>
      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void save();
          }
        }}
        className="bg-panel"
      />
      <Button type="button" variant="primary" full disabled={!changed || busy} onClick={() => void save()}>
        {copy(locale, "タイトルを保存", "Save title")}
      </Button>
    </div>
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
  const [printSize, setPrintSize] = useState(item?.printSize ?? "");
  const [note, setNote] = useState(item?.note ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const initialOrdinaryUnit = item
    ? item.customAmount && item.quantity > 0
      ? item.amount / item.quantity
      : item.unitPrice
    : 0;
  const ordinaryPrice = useLinkedAmounts({
    quantity,
    initialUnit: initialOrdinaryUnit,
    initialTotal: item?.amount,
    initialSource: item?.customAmount ? "total" : "unit",
  });
  const printCost = useLinkedAmounts({
    quantity,
    initialUnit: item?.type === "PRINT" ? item.printCostUnitPrice : null,
    initialTotal: item?.type === "PRINT" ? item.printCostAmount : null,
    initialSource: "unit",
  });
  const manualBillingTotal = item?.type === "PRINT" && item.billingPriceManual ? item.amount : null;
  const billingOverride = useLinkedAmounts({
    quantity,
    initialUnit: manualBillingTotal && item && item.quantity > 0 ? manualBillingTotal / item.quantity : null,
    initialTotal: manualBillingTotal,
    initialSource: "total",
  });

  const locked = !!item && isBillingLocked(item);
  const qty = positiveNumber(quantity);
  const isPrint = type === "PRINT";
  const printCostTotal = printCost.totalNumber ?? 0;
  const costUnitValue = printCost.unitNumber;
  const calculatedSuggested = printCostTotal > 0
    ? suggestedPrintBillingTotal(printCostTotal)
    : item?.type === "PRINT"
      ? item.suggestedAmount ?? 0
      : 0;
  const suggestedUnit = qty && calculatedSuggested > 0 ? calculatedSuggested / qty : 0;
  const finalBillingValue = billingOverride.totalNumber;
  const printNeedsReview = !!item && item.type === "PRINT" && priceState(item) !== "CONFIRMED";
  const quantityChanged = !!item && qty != null && roundMoney(qty) !== roundMoney(item.quantity);
  const printCostValid = costUnitValue != null && costUnitValue > 0 && printCostTotal > 0;

  const save = async () => {
    if (!description.trim() || !qty) return;

    if (!isPrint) {
      const body = {
        description,
        type,
        quantity: qty,
        unitPrice: ordinaryPrice.unitNumber ?? 0,
        amount: ordinaryPrice.source === "total" ? ordinaryPrice.totalNumber ?? 0 : null,
        confirmPrice: !!item,
        note,
      };
      const ok = await run(
        () => item
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

      const shouldConfirmCost = printCostValid && (
        !item ||
        item.type !== "PRINT" ||
        printCost.touched ||
        quantityChanged ||
        item.priceReviewStatus !== "CONFIRMED"
      );
      if (shouldConfirmCost && costUnitValue != null) {
        current = await api<BillingItem>(`/api/printing-items/${current.id}/price`, {
          method: "POST",
          body: {
            unitPrice: costUnitValue,
            amount: printCostTotal,
            confirm: true,
          },
        });
      }

      if (billingOverride.touched && finalBillingValue != null && finalBillingValue > 0) {
        const suggested = current.suggestedAmount ?? calculatedSuggested;
        const shouldOverride = current.billingPriceManual || roundMoney(finalBillingValue) !== roundMoney(suggested || 0);
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
          <p className="rounded-2xl bg-fill px-4 py-3 text-[13px] leading-relaxed text-muted">{t("project.lockedNotice")}</p>
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
            <Button variant="primary" full onClick={save} disabled={!description.trim() || !qty || busy}>{t("common.save")}</Button>
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

              <LinkedPriceSection
                title={copy(locale, "印刷原価", "Print cost")}
                hint={copy(locale, "単価・合計どちらからでも入力できます。", "Enter either unit or total cost.")}
                unitLabel={copy(locale, "原価 / 1個", "Cost / unit")}
                totalLabel={copy(locale, "原価合計", "Cost total")}
                unit={printCost.unit}
                total={printCost.total}
                onUnitChange={printCost.setUnit}
                onTotalChange={printCost.setTotal}
              />

              <div className="space-y-3 rounded-2xl border border-line bg-fill/40 p-3.5">
                <div>
                  <p className="text-[11.5px] text-faint">{copy(locale, "推奨請求", "Suggested billing")}</p>
                  <Amount value={calculatedSuggested > 0 ? money(calculatedSuggested) : "—"} strong className="mt-1 block text-[18px]" />
                  <p className="mt-1 text-[11px] leading-relaxed text-muted">
                    {copy(locale, "原価から自動計算し、5ドル / 10ドル単位で切り上げます。", "Calculated from cost and rounded upward to clean $5 / $10 steps.")}
                  </p>
                </div>
                <div className="border-t border-line pt-3">
                  <p className="mb-3 text-[12px] leading-relaxed text-muted">
                    {copy(locale, "請求額を手入力する場合も、単価・合計どちらからでも入力できます。空欄なら推奨額を使います。", "For a manual billing price, enter either unit or total. Leave both blank to use the suggested price.")}
                  </p>
                  <div className="space-y-3">
                    <Field label={copy(locale, "請求 / 1個", "Billing / unit")}>
                      <Input
                        inputMode="decimal"
                        value={billingOverride.unit}
                        onChange={(event) => billingOverride.setUnit(event.target.value)}
                        placeholder={suggestedUnit > 0 ? formatUnit(suggestedUnit) : "—"}
                        className="tnum bg-panel"
                      />
                    </Field>
                    <Field label={copy(locale, "請求合計", "Billing total")}>
                      <Input
                        inputMode="decimal"
                        value={billingOverride.total}
                        onChange={(event) => billingOverride.setTotal(event.target.value)}
                        placeholder={calculatedSuggested > 0 ? calculatedSuggested.toFixed(2) : "—"}
                        className="tnum bg-panel"
                      />
                    </Field>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <Field label={t("item.quantity")}>
                <Input inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="tnum" />
              </Field>
              <LinkedPriceSection
                title={copy(locale, "請求額", "Billing price")}
                hint={copy(locale, "単価・合計どちらを入力しても、もう片方を自動計算します。", "Enter either unit price or total. The other value updates automatically.")}
                unitLabel={t("item.unitPrice")}
                totalLabel={t("item.amount")}
                unit={ordinaryPrice.unit}
                total={ordinaryPrice.total}
                onUnitChange={ordinaryPrice.setUnit}
                onTotalChange={ordinaryPrice.setTotal}
              />
            </>
          )}

          <Field label={t("item.note")} hint={t("common.optional")}>
            <Input value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>

          {item && (
            <div className="space-y-2 border-t border-line pt-4">
              {printNeedsReview ? (
                <div className="rounded-2xl border border-review/25 bg-review/10 px-4 py-3">
                  <p className="text-[13px] font-medium text-review">
                    {copy(locale, "先に印刷原価を確認して保存してください", "Confirm and save the print cost first")}
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted">
                    {copy(locale, "価格確認後に納品操作が有効になります", "Delivery becomes available after the price is confirmed")}
                  </p>
                </div>
              ) : (
                <ItemProductionAction item={item} size="md" full onDone={onClose} />
              )}

              {item.billingStatus !== "NEEDS_REVIEW" ? (
                <Button variant="secondary" full onClick={() => changeStatus("NEEDS_REVIEW")} disabled={busy}>{t("item.markReview")}</Button>
              ) : (
                <Button variant="secondary" full onClick={() => changeStatus("NOT_READY")} disabled={busy}>{t("item.markInProgress")}</Button>
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

function LinkedPriceSection({
  title,
  hint,
  unitLabel,
  totalLabel,
  unit,
  total,
  onUnitChange,
  onTotalChange,
}: {
  title: string;
  hint: string;
  unitLabel: string;
  totalLabel: string;
  unit: string;
  total: string;
  onUnitChange: (value: string) => void;
  onTotalChange: (value: string) => void;
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-line bg-fill/40 p-3.5">
      <div>
        <p className="text-[12px] font-medium text-text">{title}</p>
        <p className="mt-1 text-[11.5px] leading-relaxed text-muted">{hint}</p>
      </div>
      <Field label={unitLabel}>
        <Input inputMode="decimal" value={unit} onChange={(event) => onUnitChange(event.target.value)} placeholder="0" className="tnum bg-panel" />
      </Field>
      <Field label={totalLabel}>
        <Input inputMode="decimal" value={total} onChange={(event) => onTotalChange(event.target.value)} placeholder="0" className="tnum bg-panel" />
      </Field>
    </div>
  );
}

function positiveNumber(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatUnit(value: number): string {
  const rounded = Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
  return rounded.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
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
