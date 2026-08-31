"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useState } from "react";

import { DeliverButton, DeliveredMark, UndeliverButton } from "@/components/delivery";
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
  Select,
  Sheet,
  StatusTag,
} from "@/components/ui";
import {
  flowStatus,
  isHistoricalRecord,
  isOperationalRecord,
  projectDelivered,
  sum,
} from "@/lib/derive";
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
  const delivered = !historyView && projectDelivered(items);
  const deliveredAt = items.find((item) => item.deliveredAt)?.deliveredAt ?? null;
  const canUndo =
    !historyView && delivered && items.every((item) => item.billingStatus === "READY_TO_INVOICE");
  const backHref = historyView ? "/designer/archive" : "/designer/projects";
  const backLabel = historyView ? t("productionArchive.title") : t("projects.title");

  return (
    <div className="animate-rise">
      <div className="px-5 pt-6 sm:px-8 sm:pt-8">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-[13px] text-muted transition-colors hover:text-text"
        >
          <ChevronRight className="h-3.5 w-3.5 rotate-180" />
          {backLabel}
        </Link>
      </div>

      <div className="flex items-end justify-between gap-6 px-5 pb-5 pt-3 sm:px-8">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.021em] sm:text-[30px]">
            {project.name}
          </h1>
          <p className="mt-1.5 text-[13.5px] text-muted">
            {client?.name} · {mediumDate(project.date, locale)} ·{" "}
            {historyView ? t("productionArchive.historyLabel") : project.createdBy}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[12px] text-faint">{t("project.total")}</div>
          <Amount
            value={money(sum(items))}
            strong
            className="text-[24px] tracking-[-0.02em] sm:text-[26px]"
          />
        </div>
      </div>

      {/* Historical imports are evidence, not editable production work. */}
      <div className="border-y border-line bg-panel px-5 py-4 sm:mx-8 sm:rounded-2xl sm:border sm:px-6">
        {historyView ? (
          <p className="text-[13px] leading-relaxed text-muted">
            {t("productionArchive.historyNotice")}
          </p>
        ) : delivered ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <DeliveredMark
              date={deliveredAt ? mediumDate(deliveredAt.slice(0, 10), locale) : undefined}
            />
            {canUndo && <UndeliverButton projectId={project.id} />}
          </div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-[14px] font-medium">{t("delivery.notYet")}</p>
              <p className="mt-0.5 text-[12.5px] text-faint">
                {items.length ? t("delivery.confirmBody") : t("delivery.needsItems")}
              </p>
            </div>
            <DeliverButton
              projectId={project.id}
              disabled={items.length === 0}
              full
              size="md"
            />
          </div>
        )}
      </div>

      <div className="mt-4 divide-y divide-line border-y border-line bg-panel sm:mx-8 sm:rounded-2xl sm:border">
        {items.length === 0 ? (
          <div className="px-5 py-10 text-center sm:px-6">
            <p className="text-[14px] text-muted">{t("project.noItems")}</p>
            <p className="mt-1 text-[13px] text-faint">{t("project.noItemsHint")}</p>
          </div>
        ) : (
          items.map((item) => {
            const content = (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] tracking-[-0.01em]">
                    {item.description}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 text-[12.5px] text-faint">
                    {item.quantity !== 1 && (
                      <span className="tnum">
                        {item.quantity} × {money(item.unitPrice)}
                      </span>
                    )}
                    <StatusTag status={flowStatus(item)} />
                  </span>
                </span>
                <Amount value={money(item.amount)} className="text-[15px]" />
                {!historyView && <ChevronRight className="h-4 w-4 shrink-0 text-faint" />}
              </>
            );
            return historyView ? (
              <div key={item.id} className="flex w-full items-center gap-4 px-5 py-3.5 sm:px-6">
                {content}
              </div>
            ) : (
              <button
                key={item.id}
                onClick={() => setEditing(item)}
                className="flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors duration-150 hover:bg-fill active:bg-fill sm:px-6"
              >
                {content}
              </button>
            );
          })
        )}

        {!historyView && (
          <button
            onClick={() => setAdding(true)}
            className="flex w-full items-center gap-2 px-5 py-3.5 text-left text-[14.5px] font-medium text-accent transition-colors duration-150 hover:bg-fill active:bg-fill sm:px-6"
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

  const locked = item?.billingStatus === "INVOICED" || item?.billingStatus === "PAID";
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

  const setDelivery = async (delivered: boolean) => {
    if (!item) return;
    const ok = await run(
      () =>
        api(`/api/billing-items/${item.id}/delivery`, {
          method: delivered ? "POST" : "DELETE",
        }),
      { key: delivered ? "delivery.toast" : "delivery.undoToast" },
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
          <div className="flex gap-2">
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
              {item.productionStatus === "DELIVERED" ? (
                <Button full onClick={() => setDelivery(false)} disabled={busy}>
                  {t("delivery.undo")}
                </Button>
              ) : (
                <Button variant="primary" full onClick={() => setDelivery(true)} disabled={busy}>
                  {t("delivery.mark")}
                </Button>
              )}
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

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line pb-3 text-[14px] last:border-0">
      <span className="text-muted">{label}</span>
      <span>{children}</span>
    </div>
  );
}
