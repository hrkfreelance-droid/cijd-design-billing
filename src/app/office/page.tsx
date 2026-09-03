"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { ChevronDown } from "@/components/icons";
import { api, useI18n, useSession } from "@/components/providers";
import { PageSkeleton, useScope } from "@/components/scope";
import { useAction } from "@/components/use-action";
import { Amount, Button, Checkbox, EmptyState, Field, Input, Sheet } from "@/components/ui";
import { can } from "@/lib/auth/roles";
import { calculateBillingLine } from "@/lib/billing-pricing";
import { isOperationalRecord, isPrintPriceConfirmed, isProductionComplete, sum } from "@/lib/derive";
import { money, roundMoney } from "@/lib/format";
import type { BillingDiscountType, BillingItem, Client, Invoice, PltFormat } from "@/lib/types";

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
          <h1 className="text-[28px] font-semibold tracking-[-0.025em] text-text sm:text-[32px]">{t("billing.ready")}</h1>
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
  const [invoiceSettingsOpen, setInvoiceSettingsOpen] = useState(false);

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

  const createInvoice = async (settings: InvoiceSettings) => {
    if (!selectedItems.length) return false;
    const result = await runResult<Invoice>(
      () => api<Invoice>("/api/invoices/options", {
        method: "POST",
        body: {
          clientId: client.id,
          billingItemIds: selectedItems.map((item) => item.id),
          ...settings,
        },
      }),
      { key: "toast.invoiceCreated" },
    );
    return Boolean(result);
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
              <Button variant="primary" onClick={() => setInvoiceSettingsOpen(true)} disabled={!selectedItems.length || busy}>
                {t("billing.createInvoice")}
              </Button>
            </div>
          </>
        )}
      </section>

      <BillingProjectModal project={editingProject} open={editingProject !== null} onClose={() => setEditingProjectId(null)} />
      <InvoiceSettingsSheet
        open={invoiceSettingsOpen}
        client={client}
        itemCount={selectedItems.length}
        total={sum(selectedItems)}
        busy={busy}
        onClose={() => setInvoiceSettingsOpen(false)}
        onCreate={async (settings) => {
          const ok = await createInvoice(settings);
          if (ok) setInvoiceSettingsOpen(false);
        }}
      />
    </>
  );
}

type InvoiceSettings = {
  poNumber: string;
  showParentCompany: boolean;
  parentCompanyName: string;
  pltFormat: PltFormat;
  stateChargeVat: boolean;
  noVat: boolean;
  customerNote: string;
  staffNote: string;
};

function InvoiceSettingsSheet({
  open,
  client,
  itemCount,
  total,
  busy,
  onClose,
  onCreate,
}: {
  open: boolean;
  client: Client;
  itemCount: number;
  total: number;
  busy: boolean;
  onClose: () => void;
  onCreate: (settings: InvoiceSettings) => Promise<void>;
}) {
  const { locale } = useI18n();
  const [poNumber, setPoNumber] = useState("");
  const [showParentCompany, setShowParentCompany] = useState(false);
  const [parentCompanyName, setParentCompanyName] = useState("");
  const [pltFormat, setPltFormat] = useState<PltFormat>("NORMAL");
  const [stateChargeVat, setStateChargeVat] = useState(false);
  const [noVat, setNoVat] = useState(false);
  const [customerNote, setCustomerNote] = useState("");
  const [staffNote, setStaffNote] = useState("");
  const invalid = showParentCompany && !parentCompanyName.trim();

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={copy(locale, "請求書設定", "Invoice settings")}
      description={`${client.name} · ${itemCount} ${copy(locale, "項目", "items")} · ${money(total)}`}
      footer={
        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          <Button variant="secondary" full onClick={onClose}>{copy(locale, "閉じる", "Close")}</Button>
          <Button
            variant="primary"
            full
            disabled={busy || invalid}
            onClick={() => void onCreate({ poNumber, showParentCompany, parentCompanyName, pltFormat, stateChargeVat, noVat, customerNote, staffNote })}
          >
            {copy(locale, "請求書を作成", "Create invoice")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label="PO Number" hint={copy(locale, "任意", "Optional")}>
          <Input value={poNumber} onChange={(event) => setPoNumber(event.target.value)} />
        </Field>

        <div className="rounded-2xl border border-line bg-fill p-4">
          <Checkbox checked={showParentCompany} onChange={() => setShowParentCompany((value) => !value)} label="Show Parent Company in PDF" />
          {showParentCompany && (
            <div className="mt-3">
              <Field label="Parent Company Name">
                <Input value={parentCompanyName} onChange={(event) => setParentCompanyName(event.target.value)} />
              </Field>
            </div>
          )}
        </div>

        <Field label="PLT Format">
          <select value={pltFormat} onChange={(event) => setPltFormat(event.target.value as PltFormat)} className={selectClass}>
            <option value="NORMAL">Normal</option>
            <option value="IMPORT_PRODUCT">Import Product</option>
            <option value="DISTRIBUTOR">Distributor</option>
          </select>
        </Field>

        <div className="rounded-2xl border border-line bg-fill p-4">
          <p className="mb-3 text-[13px] font-medium text-text">VAT</p>
          <div className="space-y-3">
            <Checkbox
              checked={stateChargeVat}
              onChange={() => {
                setStateChargeVat((value) => !value);
                if (!stateChargeVat) setNoVat(false);
              }}
              label="State Charge VAT"
            />
            <Checkbox
              checked={noVat}
              onChange={() => {
                setNoVat((value) => !value);
                if (!noVat) setStateChargeVat(false);
              }}
              label="No VAT"
            />
          </div>
          <p className="mt-3 text-[11.5px] leading-5 text-faint">
            {copy(locale, "既存システムにVAT率計算が無いため、今回は帳票設定として保存・表示します。両方を同時には選択できません。", "The current system has no VAT-rate calculation, so these are saved as document settings only. They cannot both be enabled.")}
          </p>
        </div>

        <Field label="Customer Note" hint={copy(locale, "PDFに表示", "Shown in customer PDF")}>
          <textarea value={customerNote} onChange={(event) => setCustomerNote(event.target.value)} rows={3} className={textareaClass} />
        </Field>
        <Field label="Staff Note" hint={copy(locale, "社内のみ・PDF非表示", "Internal only · never shown in PDF")}>
          <textarea value={staffNote} onChange={(event) => setStaffNote(event.target.value)} rows={3} className={textareaClass} />
        </Field>
      </div>
    </Sheet>
  );
}

type BillingDraft = {
  originalName: string;
  unit: string;
  quantity: string;
  discountType: BillingDiscountType;
  discountValue: string;
  total: string;
};

function draftFor(item: BillingItem): BillingDraft {
  const discountType = item.discountType ?? "NONE";
  const discountValue = item.discountValue ?? 0;
  const calculated = calculateBillingLine(item.quantity, item.unitPrice, discountType, discountValue);
  return {
    originalName: item.originalName ?? item.description,
    unit: formatUnit(item.unitPrice),
    quantity: formatUnit(item.quantity),
    discountType,
    discountValue: discountValue > 0 ? formatUnit(discountValue) : "",
    total: calculated.subtotal.toFixed(2),
  };
}

function BillingProjectModal({ project, open, onClose }: {
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

  const update = (item: BillingItem, patch: Partial<BillingDraft>) => {
    setValues((current) => {
      const next = { ...(current[item.id] ?? draftFor(item)), ...patch };
      const unit = parseAmount(next.unit) ?? 0;
      const quantity = parseAmount(next.quantity) ?? 0;
      const discount = parseAmount(next.discountValue) ?? 0;
      next.total = calculateBillingLine(quantity, unit, next.discountType, discount).subtotal.toFixed(2);
      return { ...current, [item.id]: next };
    });
  };

  const invalid = project.items.some((item) => {
    const draft = values[item.id] ?? draftFor(item);
    const unit = parseAmount(draft.unit);
    const quantity = parseAmount(draft.quantity);
    const discount = parseAmount(draft.discountValue) ?? 0;
    if (unit == null || unit < 0 || quantity == null || quantity <= 0 || discount < 0) return true;
    if (draft.discountType === "PERCENT" && discount > 100) return true;
    if (draft.discountType === "AMOUNT" && discount > roundMoney(unit * quantity)) return true;
    return false;
  });

  const save = async () => {
    if (invalid) return;
    const changes = project.items.filter((item) => {
      const draft = values[item.id] ?? draftFor(item);
      const unit = parseAmount(draft.unit) ?? 0;
      const quantity = parseAmount(draft.quantity) ?? 0;
      const discount = parseAmount(draft.discountValue) ?? 0;
      return draft.originalName.trim() !== (item.originalName ?? item.description).trim()
        || roundMoney(unit) !== roundMoney(item.unitPrice)
        || quantity !== item.quantity
        || draft.discountType !== (item.discountType ?? "NONE")
        || roundMoney(discount) !== roundMoney(item.discountValue ?? 0);
    });
    if (!changes.length) {
      onClose();
      return;
    }
    const ok = await run(
      async () => {
        for (const item of changes) {
          const draft = values[item.id] ?? draftFor(item);
          await api(`/api/billing-items/${item.id}/billing-line`, {
            method: "POST",
            body: {
              originalName: draft.originalName,
              unitPrice: parseAmount(draft.unit) ?? 0,
              quantity: parseAmount(draft.quantity) ?? 0,
              discountType: draft.discountType,
              discountValue: parseAmount(draft.discountValue) ?? 0,
            },
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
      description={copy(locale, "請求書に出す商品名・単価・数量・値引き・小計を確認します", "Review original name, unit price, quantity, discount and subtotal for the invoice")}
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
                  {item.type === "PRINT" && <p className="mt-0.5 text-[11.5px] text-faint">{copy(locale, "数量変更時は印刷価格の再確認が必要です", "Changing print quantity requires price review again")}</p>}
                </div>
                {item.type === "PRINT" && (
                  <p className="shrink-0 text-right text-[11.5px] text-muted">
                    {copy(locale, "原価", "Cost")} {item.printCostAmount != null ? money(item.printCostAmount) : "—"}
                  </p>
                )}
              </div>

              <Field label="Original Name">
                <Input value={draft.originalName} onChange={(event) => update(item, { originalName: event.target.value })} />
              </Field>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label={copy(locale, "単価", "Unit Price")}>
                  <Input inputMode="decimal" value={draft.unit} onChange={(event) => update(item, { unit: event.target.value })} placeholder="0" className="tnum" />
                </Field>
                <Field label={copy(locale, "数量", "Quantity")}>
                  <Input inputMode="decimal" value={draft.quantity} onChange={(event) => update(item, { quantity: event.target.value })} placeholder="1" className="tnum" />
                </Field>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Discount">
                  <select value={draft.discountType} onChange={(event) => update(item, { discountType: event.target.value as BillingDiscountType })} className={selectClass}>
                    <option value="NONE">No discount</option>
                    <option value="PERCENT">Percent (%)</option>
                    <option value="AMOUNT">Amount ($)</option>
                  </select>
                </Field>
                <Field label={draft.discountType === "PERCENT" ? "Discount % (0–100)" : draft.discountType === "AMOUNT" ? "Discount $" : "Discount value"}>
                  <Input
                    inputMode="decimal"
                    value={draft.discountValue}
                    disabled={draft.discountType === "NONE"}
                    onChange={(event) => update(item, { discountValue: event.target.value })}
                    placeholder="0"
                    className="tnum"
                  />
                </Field>
              </div>

              <div className="mt-3 flex items-center justify-between rounded-xl bg-fill px-3 py-2.5">
                <span className="text-[12px] text-muted">Sub Total</span>
                <Amount value={money(parseAmount(draft.total) ?? 0)} strong className="text-[15px]" />
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

const selectClass = "h-11 w-full rounded-xl border border-line-strong bg-fill px-3 text-[14px] text-text outline-none focus:border-accent focus:bg-raise";
const textareaClass = "min-h-[88px] w-full resize-y rounded-xl border border-line-strong bg-fill px-3 py-2.5 text-[14px] text-text outline-none placeholder:text-faint focus:border-accent focus:bg-raise";

function parseAmount(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function formatUnit(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "";
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
