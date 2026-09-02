"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { CurrencyAmount } from "@/components/currency-amount";
import { ChevronDown } from "@/components/icons";
import { api, useI18n, useSession } from "@/components/providers";
import { PageSkeleton, useScope } from "@/components/scope";
import { useAction } from "@/components/use-action";
import {
  Button,
  Checkbox,
  EmptyState,
  Field,
  Input,
  PageHeader,
  PageTotal,
  Sheet,
  StatusPill,
} from "@/components/ui";
import { can } from "@/lib/auth/roles";
import {
  isOperationalRecord,
  isPrintPriceConfirmed,
  isProductionComplete,
  sum,
} from "@/lib/derive";
import { formatKhr } from "@/lib/exchange-rate";
import { mediumDate, money, roundMoney, todayIso } from "@/lib/format";
import type { BillingItem, Client, Invoice } from "@/lib/types";

export default function OfficeBillingPage() {
  const scope = useScope();
  const { t } = useI18n();
  const { user } = useSession();
  const router = useRouter();
  const allowed = !!user && can(user.role, "billing:read");

  useEffect(() => {
    if (user && !allowed) router.replace("/office/payments");
  }, [user, allowed, router]);

  const groups = useMemo(() => {
    if (!scope) return [];
    const ready = scope.items.filter(
      (item) => isOperationalRecord(item) && isProductionComplete(item) && item.billingStatus === "READY_TO_INVOICE",
    );
    const byClient = new Map<string, BillingItem[]>();
    for (const item of ready) {
      const clientId = scope.idx.projectById.get(item.projectId)?.clientId;
      if (!clientId) continue;
      const list = byClient.get(clientId);
      if (list) list.push(item);
      else byClient.set(clientId, [item]);
    }
    return Array.from(byClient)
      .map(([clientId, items]) => ({ client: scope.idx.clientById.get(clientId)!, items }))
      .filter((group) => group.client)
      .sort((a, b) => {
        const aDate = firstProjectDate(a.items, (id) => scope.idx.projectById.get(id)?.date);
        const bDate = firstProjectDate(b.items, (id) => scope.idx.projectById.get(id)?.date);
        return aDate.localeCompare(bDate);
      });
  }, [scope]);

  const pendingPrintItems = useMemo(
    () =>
      scope?.items
        .filter((item) => isOperationalRecord(item) && item.type === "PRINT" && !isPrintPriceConfirmed(item))
        .slice()
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)) ?? [],
    [scope],
  );

  if (!scope || !allowed) return <PageSkeleton />;

  const readyTotal = sum(groups.flatMap((group) => group.items));
  const exchangeRate = scope.snapshot.exchangeRate;

  return (
    <div className="animate-rise">
      <PageHeader
        title={t("billing.ready")}
        subtitle={scope.client ? scope.client.name : t("client.all")}
        action={
          <PageTotal
            value={money(readyTotal)}
            secondaryValue={exchangeRate ? formatKhr(readyTotal, exchangeRate.rate) : undefined}
            secondaryLabel={exchangeRate ? t("currency.rate", { rate: exchangeRate.rate }) : undefined}
            rate={exchangeRate?.rate}
            rateEffectiveDate={exchangeRate?.effectiveDate}
            rateFetchedAt={scope.snapshot.exchangeRateLastCheckedAt}
          />
        }
      />

      {groups.length === 0 ? (
        <EmptyState title={t("billing.readyEmpty")} />
      ) : (
        <div className="space-y-3 px-5 pb-8 sm:px-8">
          {groups.map((group) => <ReadyGroup key={group.client.id} client={group.client} items={group.items} />)}
        </div>
      )}

      {pendingPrintItems.length > 0 && <PrintPriceQueue items={pendingPrintItems} />}
    </div>
  );
}

function PrintPriceQueue({ items }: { items: BillingItem[] }) {
  const { t, locale } = useI18n();
  const scope = useScope();

  return (
    <section className="pt-6">
      <div className="px-5 pb-1 sm:px-8">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{t("billing.printPricePendingTitle")}</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-faint">
          {copy(locale, "印刷スタッフまたはデザイナーが原価を確定すると、推奨請求額が自動計算されます。", "Printing staff or a Designer confirms cost first; the suggested billing price is then calculated automatically.")}
        </p>
      </div>
      <div className="divide-y divide-line border-y border-line bg-panel sm:mx-8 sm:rounded-2xl sm:border">
        {items.map((item) => {
          const project = scope?.idx.projectById.get(item.projectId);
          const client = project ? scope?.idx.clientById.get(project.clientId) : undefined;
          return (
            <div key={item.id} className="flex items-start gap-3 px-5 py-2.5 sm:px-6">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px] font-medium">{project?.name ?? ""}</span>
                <span className="mt-0.5 block truncate text-[12.5px] text-faint">{client?.name} · {printLabel(item)}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-[13px] tnum">{item.printCostAmount ? `${copy(locale, "原価", "Cost")} ${money(item.printCostAmount)}` : copy(locale, "原価未確定", "Cost pending")}</span>
                {item.suggestedAmount != null && item.suggestedAmount > 0 && (
                  <span className="mt-1 block text-[11.5px] text-faint">{copy(locale, "推奨", "Suggested")} {money(item.suggestedAmount)}</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ReadyGroup({ client, items }: { client: Client; items: BillingItem[] }) {
  const { t, locale } = useI18n();
  const scope = useScope();
  const { runResult, busy } = useAction();
  const [open, setOpen] = useState(true);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);

  const projects = useMemo(() => {
    const groups = new Map<string, BillingItem[]>();
    for (const item of items) {
      const list = groups.get(item.projectId);
      if (list) list.push(item);
      else groups.set(item.projectId, [item]);
    }
    return Array.from(groups)
      .map(([projectId, projectItems]) => ({
        id: projectId,
        name: scope?.idx.projectById.get(projectId)?.name ?? "",
        date: scope?.idx.projectById.get(projectId)?.date ?? "",
        createdAt: scope?.idx.projectById.get(projectId)?.createdAt ?? "",
        items: projectItems.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        total: sum(projectItems),
      }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  }, [items, scope]);

  const selectedProjects = projects.filter((project) => !skipped.has(project.id));
  const selectedItems = selectedProjects.flatMap((project) => project.items);
  const editingProject = projects.find((project) => project.id === editingProjectId) ?? null;

  const markInvoiced = async () => {
    if (!selectedItems.length) return;
    await runResult<Invoice>(
      () => api<Invoice>("/api/invoices", {
        method: "POST",
        body: { clientId: client.id, invoiceDate: todayIso(), billingItemIds: selectedItems.map((item) => item.id) },
      }),
      { key: "toast.invoiceCreated" },
    );
  };

  const toggle = (id: string) => {
    setSkipped((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      <section className="overflow-hidden border-y border-line bg-panel sm:rounded-2xl sm:border">
        <button
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors duration-150 hover:bg-fill sm:px-6"
        >
          <ChevronDown className={`h-4 w-4 shrink-0 text-faint transition-transform duration-200 ${open ? "" : "-rotate-90"}`} />
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-[-0.01em]">{client.name}</span>
          <span className="text-[12.5px] text-faint">{t("billing.items", { count: items.length })}</span>
          <CurrencyAmount usd={sum(items)} rate={scope?.snapshot.exchangeRate?.rate} strong className="text-[15px]" />
        </button>

        {open && (
          <>
            <div className="divide-y divide-line border-t border-line">
              {projects.map((project) => {
                const checked = !skipped.has(project.id);
                return (
                  <div
                    key={project.id}
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      if (event.target instanceof Element && event.target.closest("[role='checkbox']")) return;
                      setEditingProjectId(project.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      setEditingProjectId(project.id);
                    }}
                    className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 px-5 py-2.5 outline-none transition-colors hover:bg-fill focus-visible:ring-2 focus-visible:ring-accent sm:px-6 sm:py-2"
                  >
                    <Checkbox checked={checked} onChange={() => toggle(project.id)} label={project.name} />
                    <div className={`min-w-0 transition-opacity duration-150 ${checked ? "" : "opacity-45"}`}>
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="min-w-0 truncate text-[14.5px] font-medium">{project.name}</span>
                        <StatusPill status="READY_TO_INVOICE" />
                      </span>
                      <span className="mt-1 block truncate text-[12.5px] text-faint">
                        {project.items.map((item) => item.description).join(" · ")} · {mediumDate(project.date, locale)}
                      </span>
                    </div>
                    <CurrencyAmount usd={project.total} rate={scope?.snapshot.exchangeRate?.rate} className={`text-[14.5px] transition-opacity duration-150 ${checked ? "" : "opacity-45"}`} />
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col gap-3 border-t border-line px-5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <span className="text-[13px] text-muted">
                {t("billing.selected", { count: selectedItems.length })} · <CurrencyAmount usd={sum(selectedItems)} rate={scope?.snapshot.exchangeRate?.rate} className="inline-block text-[13px]" />
              </span>
              <Button variant="primary" onClick={markInvoiced} disabled={selectedItems.length === 0 || busy} className="w-full sm:w-auto">
                {t("billing.createInvoice")}
              </Button>
            </div>
          </>
        )}
      </section>

      <BillingProjectModal project={editingProject} open={editingProject !== null} onClose={() => setEditingProjectId(null)} />
    </>
  );
}

type BillingDraft = {
  unit: string;
  total: string;
};

function draftFor(item: BillingItem): BillingDraft {
  const total = roundMoney(item.amount);
  const unit = item.quantity > 0 ? total / item.quantity : 0;
  return { unit: formatUnit(unit), total: total.toFixed(2) };
}

function BillingProjectModal({
  project,
  open,
  onClose,
}: {
  project: { id: string; name: string; date: string; items: BillingItem[]; total: number } | null;
  open: boolean;
  onClose: () => void;
}) {
  const { locale } = useI18n();
  const { run, busy } = useAction();
  const [values, setValues] = useState<Record<string, BillingDraft>>({});

  useEffect(() => {
    if (!project) return;
    setValues(Object.fromEntries(project.items.map((item) => [item.id, draftFor(item)])));
  }, [project]);

  if (!project) return null;

  const setUnit = (item: BillingItem, value: string) => {
    setValues((current) => {
      const parsed = parseAmount(value);
      const total = parsed == null ? "" : roundMoney(parsed * item.quantity).toFixed(2);
      return { ...current, [item.id]: { unit: value, total } };
    });
  };

  const setTotal = (item: BillingItem, value: string) => {
    setValues((current) => {
      const parsed = parseAmount(value);
      const unit = parsed == null || item.quantity <= 0 ? "" : formatUnit(parsed / item.quantity);
      return { ...current, [item.id]: { unit, total: value } };
    });
  };

  const save = async () => {
    const changes = project.items
      .map((item) => ({ item, amount: parseAmount(values[item.id]?.total ?? "") }))
      .filter(({ item, amount }) => amount != null && amount > 0 && roundMoney(amount) !== roundMoney(item.amount));
    if (!changes.length) {
      onClose();
      return;
    }
    const ok = await run(
      async () => {
        for (const change of changes) {
          await api(`/api/billing-items/${change.item.id}/billing-price`, {
            method: "POST",
            body: { amount: change.amount },
          });
        }
      },
      { key: "toast.itemUpdated" },
    );
    if (ok) onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={project.name}
      description={copy(locale, "請求前なら単価・合計どちらからでも最終金額を訂正できます", "Before invoicing, edit either unit price or total; the other value updates automatically")}
      footer={
        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          <Button variant="secondary" full onClick={onClose}>{copy(locale, "閉じる", "Close")}</Button>
          <Button variant="primary" full onClick={save} disabled={busy}>{copy(locale, "変更を保存", "Save changes")}</Button>
        </div>
      }
    >
      <div className="space-y-3 pb-2">
        {project.items.map((item) => {
          const draft = values[item.id] ?? draftFor(item);
          return (
            <div key={item.id} className="space-y-3 rounded-2xl border border-line bg-fill/30 p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-medium">{item.description}</p>
                  <p className="mt-0.5 text-[11.5px] text-faint">{item.type} · ×{item.quantity}</p>
                </div>
                {item.billingPriceManual && <span className="shrink-0 text-[10.5px] font-medium text-review">Manual</span>}
              </div>

              {item.type === "PRINT" && (
                <p className="text-[12px] leading-relaxed text-muted">
                  {copy(locale, "原価", "Cost")} {item.printCostAmount != null ? money(item.printCostAmount) : "—"}
                  <span className="mx-1.5 text-faint">·</span>
                  {copy(locale, "推奨", "Suggested")} {item.suggestedAmount != null ? money(item.suggestedAmount) : "—"}
                </p>
              )}

              <Field label={copy(locale, "請求 / 1個", "Billing / unit")}>
                <Input
                  inputMode="decimal"
                  value={draft.unit}
                  onChange={(event) => setUnit(item, event.target.value)}
                  className="tnum bg-panel"
                />
              </Field>
              <Field label={copy(locale, "請求合計", "Billing total")}>
                <Input
                  inputMode="decimal"
                  value={draft.total}
                  onChange={(event) => setTotal(item, event.target.value)}
                  className="tnum bg-panel"
                />
              </Field>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

function parseAmount(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function formatUnit(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  const rounded = Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
  return rounded.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function firstProjectDate(items: BillingItem[], getDate: (projectId: string) => string | undefined) {
  return items.reduce((oldest, item) => {
    const value = getDate(item.projectId) ?? item.createdAt;
    return !oldest || value < oldest ? value : oldest;
  }, "");
}

function printLabel(item: BillingItem): string {
  const description = item.description.trim();
  if (/\bprint(?:ing)?\b\s+(?:[x×]\s*)?\d+\b/i.test(description)) return description;
  if (/\b[x×]\s*\d+\b/i.test(description)) return description;
  return `${description} ×${item.quantity}`;
}

function copy(locale: string, ja: string, en: string) {
  return locale === "ja" ? ja : en;
}
