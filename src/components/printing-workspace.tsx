"use client";

import { useMemo, useState } from "react";

import { ChevronRight, PlusIcon } from "@/components/icons";
import { api, useI18n, useSession } from "@/components/providers";
import { PageSkeleton, useScope } from "@/components/scope";
import { useAction } from "@/components/use-action";
import { useLinkedAmounts } from "@/components/use-linked-amounts";
import {
  Amount,
  Button,
  EmptyState,
  Field,
  Input,
  Select,
  Sheet,
  StatusPill,
  type WorkStatus,
} from "@/components/ui";
import { can } from "@/lib/auth/roles";
import { isBillingLocked, isHistoricalRecord, isProductionComplete, printPriceReviewState } from "@/lib/derive";
import { mediumDate, money, roundMoney } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { suggestedPrintBillingTotal } from "@/lib/print-pricing";
import type { BillingItem, Project } from "@/lib/types";

export type PrintingView = "review" | "history";

export function PrintingWorkspace({ view }: { view: PrintingView }) {
  const scope = useScope();
  const { t, locale } = useI18n();
  const { user } = useSession();
  const [selected, setSelected] = useState<BillingItem | null>(null);
  const [creating, setCreating] = useState(false);

  const items = useMemo(() => {
    if (!scope) return [];
    return scope.items
      .filter((item) => item.type === "PRINT")
      .filter((item) => view === "history" ? isHistoricalRecord(item) : !isHistoricalRecord(item))
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [scope, view]);

  const groups = useMemo(() => {
    const map = new Map<string, { project?: Project; client?: { name: string }; items: BillingItem[] }>();
    for (const item of items) {
      const project = scope?.idx.projectById.get(item.projectId);
      const client = project ? scope?.idx.clientById.get(project.clientId) : undefined;
      const existing = map.get(item.projectId);
      if (existing) existing.items.push(item);
      else map.set(item.projectId, { project, client, items: [item] });
    }
    return Array.from(map.values()).sort((a, b) =>
      (a.project?.date ?? "").localeCompare(b.project?.date ?? "") ||
      (a.project?.createdAt ?? "").localeCompare(b.project?.createdAt ?? ""),
    );
  }, [items, scope]);

  if (!scope) return <PageSkeleton />;

  const totalCost = roundMoney(items.reduce((total, item) => total + Math.max(item.printCostAmount ?? 0, 0), 0));
  const pending = items.filter((item) => printPriceReviewState(item) !== "CONFIRMED").length;
  const canCreate = view === "review" && !!user && can(user.role, "production:write");

  return (
    <div className="animate-rise mx-auto w-full max-w-[1000px] px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold tracking-[-0.025em] text-text sm:text-[32px]">
            {view === "review" ? t("printing.title") : t("printing.historyTitle")}
          </h1>
          <p className="mt-1 text-[13px] text-muted">
            {items.length} {copy(locale, "件", "items")}
            {view === "review" && pending > 0 ? ` · ${pending} ${copy(locale, "原価待ち", "pending")}` : ""}
          </p>
        </div>

        <div className="flex items-end gap-3">
          <div className="shrink-0 text-right">
            <p className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-faint">{copy(locale, "印刷原価", "Print cost")}</p>
            <Amount value={totalCost > 0 ? money(totalCost) : "—"} strong className="mt-0.5 block text-[20px]" />
          </div>
          {canCreate && (
            <Button variant="primary" onClick={() => setCreating(true)} className="!h-10">
              <PlusIcon className="h-4 w-4" />
              {copy(locale, "印刷新規", "New print")}
            </Button>
          )}
        </div>
      </header>

      {items.length === 0 ? (
        <EmptyState title={view === "history" ? t("printing.emptyHistory") : t("printing.emptyReview")} />
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <PrintProjectBlock
              key={group.items[0].projectId}
              group={group}
              locale={locale}
              history={view === "history"}
              onOpen={setSelected}
            />
          ))}
        </div>
      )}

      <PrintItemModal
        key={selected?.id ?? "closed"}
        item={selected}
        history={view === "history"}
        open={selected !== null}
        onClose={() => setSelected(null)}
      />
      {creating && <NewPrintJobSheet open onClose={() => setCreating(false)} />}
    </div>
  );
}

function PrintProjectBlock({
  group,
  locale,
  history,
  onOpen,
}: {
  group: { project?: Project; client?: { name: string }; items: BillingItem[] };
  locale: Locale;
  history: boolean;
  onOpen: (item: BillingItem) => void;
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
        {group.items.map((item) => (
          <PrintItemRow key={item.id} item={item} history={history} onOpen={() => onOpen(item)} />
        ))}
      </div>
    </section>
  );
}

function PrintItemRow({ item, history, onOpen }: { item: BillingItem; history: boolean; onOpen: () => void }) {
  const { locale } = useI18n();
  const review = printPriceReviewState(item);
  const confirmed = review === "CONFIRMED";
  const finished = isProductionComplete(item);
  const status: WorkStatus = finished ? "DELIVERED" : confirmed ? "IN_PROGRESS" : "NEEDS_REVIEW";
  const cost = item.printCostAmount ?? 0;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-fill/60 sm:px-5"
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <StatusPill status={status} className="shrink-0" />
          <p className="truncate text-[14.5px] font-medium">{item.description}</p>
        </div>
        <p className="mt-1 truncate text-[11.5px] text-faint">
          {item.printSize ? `${item.printSize} · ` : ""}×{item.quantity}
          {item.suggestedAmount ? ` · ${copy(locale, "推奨", "Suggested")} ${money(item.suggestedAmount)}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Amount value={cost > 0 ? money(cost) : "—"} strong className="text-[14px]" />
        <ChevronRight className="h-4 w-4 text-faint" />
      </div>
      {history && <span className="sr-only">{copy(locale, "履歴", "History")}</span>}
    </button>
  );
}

function PrintItemModal({
  item,
  history,
  open,
  onClose,
}: {
  item: BillingItem | null;
  history: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const { locale } = useI18n();
  const { user } = useSession();
  const { run, busy } = useAction();
  const scope = useScope();

  const [description, setDescription] = useState(item?.description ?? "");
  const [size, setSize] = useState(item?.printSize ?? "");
  const [quantity, setQuantity] = useState(String(item?.quantity ?? 1));
  const [note, setNote] = useState(item?.note ?? "");
  const [deliveryTarget, setDeliveryTarget] = useState(item ? isProductionComplete(item) : false);

  const cost = useLinkedAmounts({
    quantity,
    initialUnit: item?.printCostUnitPrice,
    initialTotal: item?.printCostAmount,
    initialSource: item?.printCostAmount ? "total" : "unit",
  });
  const billing = useLinkedAmounts({
    quantity,
    initialUnit: item && item.quantity > 0 ? item.amount / item.quantity : null,
    initialTotal: item?.amount,
    initialSource: "total",
  });

  if (!item || !scope) return null;

  const project = scope.idx.projectById.get(item.projectId);
  const client = project ? scope.idx.clientById.get(project.clientId) : undefined;
  const locked = isBillingLocked(item);
  const readOnly = history || locked;
  const canEditBilling = !!user && can(user.role, "billing:read");
  const qty = positiveNumber(quantity);
  const costUnit = cost.unitNumber;
  const costTotal = cost.totalNumber ?? 0;
  const costValid = !!qty && costUnit != null && costUnit > 0 && costTotal > 0;
  const confirmed = printPriceReviewState(item) === "CONFIRMED";
  const suggested = costTotal > 0 ? suggestedPrintBillingTotal(costTotal) : (item.suggestedAmount ?? 0);
  const deliveryAllowed = confirmed || costValid;
  const currentDelivered = isProductionComplete(item);

  const save = async () => {
    if (readOnly || !qty || !description.trim()) return;
    if (deliveryTarget && !deliveryAllowed) return;

    const ok = await run(
      async () => {
        await api(`/api/printing-items/${item.id}/spec`, {
          method: "PATCH",
          body: { description: description.trim(), printSize: size, quantity: qty, note },
        });

        if (costValid && (cost.touched || !confirmed) && costUnit != null) {
          await api(`/api/printing-items/${item.id}/price`, {
            method: "POST",
            body: { unitPrice: costUnit, amount: costTotal, confirm: true },
          });
        }

        if (canEditBilling && billing.touched && billing.totalNumber != null && billing.totalNumber > 0) {
          await api(`/api/billing-items/${item.id}/billing-price`, {
            method: "POST",
            body: { amount: billing.totalNumber },
          });
        }

        if (deliveryTarget !== currentDelivered) {
          await api(`/api/billing-items/${item.id}/delivery`, {
            method: deliveryTarget ? "POST" : "DELETE",
          });
        }
      },
      { key: "toast.itemUpdated" },
    );
    if (ok) onClose();
  };

  if (readOnly) {
    return (
      <Sheet
        open={open}
        onClose={onClose}
        title={item.description}
        description={[client?.name, project?.name].filter(Boolean).join(" · ")}
        footer={<Button variant="secondary" full onClick={onClose}>{copy(locale, "閉じる", "Close")}</Button>}
      >
        <div className="divide-y divide-line pb-2">
          <Summary label={copy(locale, "状態", "Status")} value={currentDelivered ? copy(locale, "納品済み", "Delivered") : copy(locale, "進行中", "In progress")} />
          <Summary label={copy(locale, "仕様", "Spec")} value={[item.printSize, `×${item.quantity}`].filter(Boolean).join(" · ")} />
          <Summary label={copy(locale, "印刷原価", "Print cost")} value={item.printCostAmount ? money(item.printCostAmount) : "—"} />
          <Summary label={copy(locale, "推奨請求", "Suggested billing")} value={item.suggestedAmount ? money(item.suggestedAmount) : "—"} />
          <Summary label={copy(locale, "最終請求", "Final billing")} value={item.amount > 0 ? money(item.amount) : "—"} />
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={copy(locale, "印刷を編集", "Edit print")}
      description={[client?.name, project?.name].filter(Boolean).join(" · ")}
      footer={
        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          <Button variant="secondary" full onClick={onClose}>{copy(locale, "キャンセル", "Cancel")}</Button>
          <Button variant="primary" full onClick={save} disabled={busy || !qty || !description.trim() || (deliveryTarget && !deliveryAllowed)}>
            {copy(locale, "保存", "Save")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label={copy(locale, "内容", "Description")}>
          <Input value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <Field label={copy(locale, "サイズ / 仕様", "Size / spec")}>
          <Input value={size} onChange={(event) => setSize(event.target.value)} placeholder="e.g. A4 / Name Card" />
        </Field>
        <Field label={copy(locale, "数量", "Quantity")}>
          <Input inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="tnum" />
        </Field>

        <div className="space-y-3 rounded-2xl border border-line bg-fill/35 p-3.5">
          <p className="text-[12px] font-medium text-muted">{copy(locale, "印刷原価", "Print cost")}</p>
          <Field label={copy(locale, "原価合計", "Cost total")}>
            <Input inputMode="decimal" value={cost.total} onChange={(event) => cost.setTotal(event.target.value)} placeholder="0" className="tnum bg-panel" />
          </Field>
          <Field label={copy(locale, "原価 / 1個", "Cost / unit")}>
            <Input inputMode="decimal" value={cost.unit} onChange={(event) => cost.setUnit(event.target.value)} placeholder="0" className="tnum bg-panel" />
          </Field>
          <div className="flex items-center justify-between border-t border-line pt-3">
            <span className="text-[12px] text-muted">{copy(locale, "推奨請求", "Suggested billing")}</span>
            <Amount value={suggested > 0 ? money(suggested) : "—"} strong className="text-[15px]" />
          </div>
        </div>

        {canEditBilling && (
          <div className="space-y-3 rounded-2xl border border-line bg-fill/35 p-3.5">
            <p className="text-[12px] font-medium text-muted">{copy(locale, "最終請求額", "Final billing")}</p>
            <Field label={copy(locale, "請求合計", "Billing total")}>
              <Input inputMode="decimal" value={billing.total} onChange={(event) => billing.setTotal(event.target.value)} className="tnum bg-panel" />
            </Field>
            <Field label={copy(locale, "請求 / 1個", "Billing / unit")}>
              <Input inputMode="decimal" value={billing.unit} onChange={(event) => billing.setUnit(event.target.value)} className="tnum bg-panel" />
            </Field>
          </div>
        )}

        <div className="space-y-3 border-t border-line pt-4">
          <div>
            <p className="text-[12px] font-medium text-muted">{copy(locale, "納品ステータス", "Delivery status")}</p>
            {!deliveryAllowed && (
              <p className="mt-1 text-[11.5px] text-review">{copy(locale, "納品前に原価を確定してください", "Confirm print cost before delivery")}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 rounded-2xl bg-fill p-1.5">
            <button
              type="button"
              onClick={() => setDeliveryTarget(false)}
              className={`min-h-10 rounded-xl px-3 text-[13px] font-medium transition-colors ${!deliveryTarget ? "bg-panel text-text shadow-sm" : "text-muted"}`}
            >
              {copy(locale, "進行中", "In progress")}
            </button>
            <button
              type="button"
              disabled={!deliveryAllowed}
              onClick={() => setDeliveryTarget(true)}
              className={`min-h-10 rounded-xl px-3 text-[13px] font-medium transition-colors ${deliveryTarget ? "bg-paid/12 text-paid" : "text-muted"} disabled:cursor-not-allowed disabled:opacity-35`}
            >
              {copy(locale, "納品済み", "Delivered")}
            </button>
          </div>
        </div>

        <Field label={copy(locale, "メモ", "Note")}>
          <Input value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}

function NewPrintJobSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const scope = useScope();
  const { locale } = useI18n();
  const { runResult, busy } = useAction();
  const clients = scope?.snapshot.clients.filter((client) => client.active) ?? [];
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [projectName, setProjectName] = useState("");
  const [description, setDescription] = useState("Print");
  const [size, setSize] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [note, setNote] = useState("");
  const cost = useLinkedAmounts({ quantity, initialSource: "total" });
  const billing = useLinkedAmounts({ quantity, initialSource: "total" });

  if (!scope) return null;

  const qty = positiveNumber(quantity);
  const costStarted = cost.unit.trim() !== "" || cost.total.trim() !== "";
  const costValid = !!qty && cost.unitNumber != null && cost.unitNumber > 0 && cost.totalNumber != null && cost.totalNumber > 0;
  const suggested = cost.totalNumber && cost.totalNumber > 0 ? suggestedPrintBillingTotal(cost.totalNumber) : 0;
  const valid = !!clientId && !!projectName.trim() && !!description.trim() && !!qty && (!costStarted || costValid);

  const create = async () => {
    if (!valid || !qty) return;
    const result = await runResult(async () => {
      const project = await api<Project>("/api/projects", {
        method: "POST",
        body: { clientId, name: projectName.trim(), note },
      });
      let item = await api<BillingItem>("/api/billing-items", {
        method: "POST",
        body: {
          projectId: project.id,
          description: description.trim(),
          type: "PRINT",
          quantity: qty,
          unitPrice: 0,
          amount: 0,
          printSize: size,
          note,
        },
      });
      if (costValid && cost.unitNumber != null && cost.totalNumber != null) {
        item = await api<BillingItem>(`/api/printing-items/${item.id}/price`, {
          method: "POST",
          body: { unitPrice: cost.unitNumber, amount: cost.totalNumber, confirm: true },
        });
      }
      if (billing.touched && billing.totalNumber != null && billing.totalNumber > 0) {
        item = await api<BillingItem>(`/api/billing-items/${item.id}/billing-price`, {
          method: "POST",
          body: { amount: billing.totalNumber },
        });
      }
      return item;
    }, { key: "toast.itemAdded" });
    if (result) onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={copy(locale, "印刷新規", "New print job")}
      description={copy(locale, "デザイン案件を経由しない印刷もここから登録できます", "Create print-only work without a design project")}
      footer={
        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          <Button variant="secondary" full onClick={onClose}>{copy(locale, "キャンセル", "Cancel")}</Button>
          <Button variant="primary" full onClick={create} disabled={busy || !valid}>{copy(locale, "作成", "Create")}</Button>
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label={copy(locale, "クライアント", "Client")}>
          <Select value={clientId} onChange={(event) => setClientId(event.target.value)}>
            <option value="" disabled>{copy(locale, "選択", "Select client")}</option>
            {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
          </Select>
        </Field>
        {clients.length === 0 && (
          <p className="rounded-xl bg-fill px-3 py-2 text-[12px] text-muted">{copy(locale, "先に上部の Clients からクライアントを登録してください", "Add a client from Clients in the top bar first")}</p>
        )}
        <Field label={copy(locale, "案件名", "Job title")}>
          <Input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="e.g. Name card reprint" />
        </Field>
        <Field label={copy(locale, "印刷内容", "Print item")}>
          <Input value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <Field label={copy(locale, "サイズ / 仕様", "Size / spec")}>
          <Input value={size} onChange={(event) => setSize(event.target.value)} placeholder="e.g. A4 / Name Card" />
        </Field>
        <Field label={copy(locale, "数量", "Quantity")}>
          <Input inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="tnum" />
        </Field>

        <div className="space-y-3 rounded-2xl border border-line bg-fill/35 p-3.5">
          <p className="text-[12px] font-medium text-muted">{copy(locale, "原価（後からでも可）", "Cost (optional now)")}</p>
          <Field label={copy(locale, "原価合計", "Cost total")}>
            <Input inputMode="decimal" value={cost.total} onChange={(event) => cost.setTotal(event.target.value)} placeholder="0" className="tnum bg-panel" />
          </Field>
          <Field label={copy(locale, "原価 / 1個", "Cost / unit")}>
            <Input inputMode="decimal" value={cost.unit} onChange={(event) => cost.setUnit(event.target.value)} placeholder="0" className="tnum bg-panel" />
          </Field>
          <div className="flex items-center justify-between border-t border-line pt-3">
            <span className="text-[12px] text-muted">{copy(locale, "推奨請求", "Suggested billing")}</span>
            <Amount value={suggested > 0 ? money(suggested) : "—"} strong className="text-[15px]" />
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border border-line bg-fill/35 p-3.5">
          <p className="text-[12px] font-medium text-muted">{copy(locale, "請求額（任意）", "Billing price (optional)")}</p>
          <Field label={copy(locale, "請求合計", "Billing total")}>
            <Input inputMode="decimal" value={billing.total} onChange={(event) => billing.setTotal(event.target.value)} placeholder={suggested > 0 ? suggested.toFixed(2) : "0"} className="tnum bg-panel" />
          </Field>
          <Field label={copy(locale, "請求 / 1個", "Billing / unit")}>
            <Input inputMode="decimal" value={billing.unit} onChange={(event) => billing.setUnit(event.target.value)} className="tnum bg-panel" />
          </Field>
        </div>

        <Field label={copy(locale, "メモ", "Note")}>
          <Input value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <span className="text-[12.5px] text-muted">{label}</span>
      <span className="text-right text-[13.5px] font-medium text-text">{value || "—"}</span>
    </div>
  );
}

function positiveNumber(value: string): number | null {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function copy(locale: string, ja: string, en: string) {
  return locale === "ja" ? ja : en;
}
