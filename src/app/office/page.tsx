"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { ChevronDown } from "@/components/icons";
import { api, useI18n, useSession } from "@/components/providers";
import { PageSkeleton, useScope } from "@/components/scope";
import { useAction } from "@/components/use-action";
import { Amount, Button, Checkbox, EmptyState, Field, Input, Sheet } from "@/components/ui";
import { can } from "@/lib/auth/roles";
import { isOperationalRecord, isPrintPriceConfirmed, isProductionComplete, sum } from "@/lib/derive";
import { money, roundMoney, todayIso } from "@/lib/format";
import type { BillingItem, Client, Invoice } from "@/lib/types";

export default function OfficeBillingPage() {
  const scope = useScope();
  const { t, locale } = useI18n();
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
      .sort((a, b) => firstProjectDate(a.items, (id) => scope.idx.projectById.get(id)?.date)
        .localeCompare(firstProjectDate(b.items, (id) => scope.idx.projectById.get(id)?.date)));
  }, [scope]);

  const pendingPrintItems = useMemo(
    () => scope?.items
      .filter((item) => isOperationalRecord(item) && item.type === "PRINT" && !isPrintPriceConfirmed(item))
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)) ?? [],
    [scope],
  );

  if (!scope || !allowed) return <PageSkeleton />;

  const readyItems = groups.flatMap((group) => group.items);
  const readyTotal = sum(readyItems);

  return (
    <div className="animate-rise mx-auto w-full max-w-[1000px] px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold tracking-[-0.025em] text-text sm:text-[32px]">
            {t("billing.ready")}
          </h1>
          <p className="mt-1 text-[13px] text-muted">
            {readyItems.length} {readyItems.length === 1 ? copy(locale, "件", "item") : copy(locale, "件", "items")}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-faint">{copy(locale, "合計", "Total")}</p>
          <Amount value={readyTotal > 0 ? money(readyTotal) : "—"} strong className="mt-0.5 block text-[22px]" />
        </div>
      </header>

      {groups.length === 0 ? (
        <EmptyState title={t("billing.readyEmpty")} />
      ) : (
        <div className="space-y-3">
          {groups.map((group) => <ReadyGroup key={group.client.id} client={group.client} items={group.items} />)}
        </div>
      )}

      {pendingPrintItems.length > 0 && <PrintPriceQueue items={pendingPrintItems} />}
    </div>
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
    const grouped = new Map<string, BillingItem[]>();
    for (const item of items) {
      const list = grouped.get(item.projectId);
      if (list) list.push(item);
      else grouped.set(item.projectId, [item]);
    }
    return Array.from(grouped)
      .map(([id, projectItems]) => ({
        id,
        name: scope?.idx.projectById.get(id)?.name ?? "",
        date: scope?.idx.projectById.get(id)?.date ?? "",
        createdAt: scope?.idx.projectById.get(id)?.createdAt ?? "",
        items: projectItems.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        total: sum(projectItems),
      }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  }, [items, scope]);

  const selectedProjects = projects.filter((project) => !skipped.has(project.id));
  const selectedItems = selectedProjects.flatMap((project) => project.items);
  const editingProject = projects.find((project) => project.id === editingProjectId) ?? null;

  const toggle = (id: string) => {
    setSkipped((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const markInvoiced = async () => {
    if (!selectedItems.length) return;
    await runResult<Invoice>(
      () => api<Invoice>("/api/invoices", {
        method: "POST",
        body: {
          clientId: client.id,
          invoiceDate: todayIso(),
          billingItemIds: selectedItems.map((item) => item.id),
        },
      }),
      { key: "toast.invoiceCreated" },
    );
  };

  return (
    <>
      <section className="overflow-hidden rounded-2xl border border-line bg-panel">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-fill/50 sm:px-5"
        >
          <ChevronDown className={`h-4 w-4 shrink-0 text-faint transition-transform ${open ? "" : "-rotate-90"}`} />
          <span className="min-w-0 flex-1 truncate text-[16px] font-semibold">{client.name}</span>
          <span className="shrink-0 text-[12px] text-faint">{items.length} {copy(locale, "件", "items")}</span>
          <Amount value={money(sum(items))} strong className="shrink-0 text-[16px]" />
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
                    className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 outline-none transition-colors hover:bg-fill/40 focus-visible:ring-2 focus-visible:ring-accent sm:px-5"
                  >
                    <Checkbox checked={checked} onChange={() => toggle(project.id)} label={project.name} />
                    <div className={`min-w-0 ${checked ? "" : "opacity-40"}`}>
                      <p className="truncate text-[15px] font-medium text-text">{project.name}</p>
                      <p className="mt-0.5 truncate text-[12px] text-faint">
                        {project.items.length} {project.items.length === 1 ? copy(locale, "項目", "item") : copy(locale, "項目", "items")}
                        {project.items[0]?.type === "PRINT" && project.items[0].printCostAmount != null
                          ? ` · ${copy(locale, "原価", "Cost")} ${money(project.items[0].printCostAmount)}`
                          : ""}
                      </p>
                    </div>
                    <Amount value={money(project.total)} strong className={`text-[15px] ${checked ? "" : "opacity-40"}`} />
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-5">
              <p className="min-w-0 truncate text-[12.5px] text-muted">
                {t("billing.selected", { count: selectedItems.length })} · {money(sum(selectedItems))}
              </p>
              <Button variant="primary" onClick={markInvoiced} disabled={!selectedItems.length || busy}>
                {t("billing.createInvoice")}
              </Button>
            </div>
          </>
        )}
      </section>

      <BillingProjectModal
        project={editingProject}
        open={editingProject !== null}
        onClose={() => setEditingProjectId(null)}
      />
    </>
  );
}

type BillingDraft = { unit: string; total: string };

function draftFor(item: BillingItem): BillingDraft {
  const total = roundMoney(item.amount);
  const unit = item.quantity > 0 ? total / item.quantity : 0;
  return { unit: formatUnit(unit), total: total > 0 ? total.toFixed(2) : "" };
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

  const setTotal = (item: BillingItem, value: string) => {
    setValues((current) => {
      const parsed = parseAmount(value);
      const unit = parsed == null || item.quantity <= 0 ? "" : formatUnit(parsed / item.quantity);
      return { ...current, [item.id]: { total: value, unit } };
    });
  };

  const setUnit = (item: BillingItem, value: string) => {
    setValues((current) => {
      const parsed = parseAmount(value);
      const total = parsed == null ? "" : roundMoney(parsed * item.quantity).toFixed(2);
      return { ...current, [item.id]: { unit: value, total } };
    });
  };

  const invalid = project.items.some((item) => {
    const draft = values[item.id] ?? draftFor(item);
    const total = parseAmount(draft.total);
    return total == null || total <= 0;
  });

  const save = async () => {
    if (invalid) return;
    const changes = project.items
      .map((item) => ({ item, amount: parseAmount((values[item.id] ?? draftFor(item)).total) }))
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
      description={copy(locale, "請求合計・単価のどちらを入力しても、もう片方を自動計算します", "Enter either billing total or unit price; the other updates automatically")}
      footer={
        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          <Button variant="secondary" full onClick={onClose}>{copy(locale, "閉じる", "Close")}</Button>
          <Button variant="primary" full onClick={save} disabled={busy || invalid}>{copy(locale, "保存", "Save")}</Button>
        </div>
      }
    >
      <div className="divide-y divide-line pb-2">
        {project.items.map((item) => {
          const draft = values[item.id] ?? draftFor(item);
          return (
            <section key={item.id} className="py-4 first:pt-1">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[14.5px] font-medium text-text">{item.description}</p>
                  <p className="mt-0.5 text-[11.5px] text-faint">×{item.quantity}</p>
                </div>
                {item.type === "PRINT" && (
                  <p className="shrink-0 text-right text-[11.5px] text-muted">
                    {copy(locale, "原価", "Cost")} {item.printCostAmount != null ? money(item.printCostAmount) : "—"}
                    {item.suggestedAmount != null ? ` · ${copy(locale, "推奨", "Suggested")} ${money(item.suggestedAmount)}` : ""}
                  </p>
                )}
              </div>

              <Field label={copy(locale, "請求合計", "Billing total")}>
                <Input
                  inputMode="decimal"
                  value={draft.total}
                  onChange={(event) => setTotal(item, event.target.value)}
                  placeholder="0"
                  className="tnum"
                />
              </Field>
              <div className="mt-3">
                <Field label={copy(locale, "単価", "Unit price")}>
                  <Input
                    inputMode="decimal"
                    value={draft.unit}
                    onChange={(event) => setUnit(item, event.target.value)}
                    placeholder="0"
                    className="tnum"
                  />
                </Field>
              </div>
            </section>
          );
        })}
      </div>
    </Sheet>
  );
}

function PrintPriceQueue({ items }: { items: BillingItem[] }) {
  const { locale } = useI18n();
  const scope = useScope();
  return (
    <section className="mt-8 border-t border-line pt-5">
      <h2 className="text-[14px] font-semibold">{copy(locale, "印刷原価待ち", "Waiting for print cost")}</h2>
      <div className="mt-2 divide-y divide-line rounded-2xl border border-line bg-panel">
        {items.map((item) => {
          const project = scope?.idx.projectById.get(item.projectId);
          return (
            <div key={item.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-[14px] font-medium">{project?.name ?? item.description}</p>
                <p className="mt-0.5 truncate text-[11.5px] text-faint">{item.description} · ×{item.quantity}</p>
              </div>
              <span className="shrink-0 text-[12px] font-medium text-review">{copy(locale, "原価未確定", "Cost pending")}</span>
            </div>
          );
        })}
      </div>
    </section>
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

function copy(locale: string, ja: string, en: string) {
  return locale === "ja" ? ja : en;
}
