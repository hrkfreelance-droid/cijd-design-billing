"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/billing-v2/confirm-dialog";
import { Modal } from "@/components/billing-v2/modal";
import { api, useI18n, useToast } from "@/components/providers";
import { Button, Checkbox, Input, Select } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { selectableClients } from "@/lib/billing-v2/board";
import { serviceForItem, serviceLabel } from "@/lib/billing-v2/services";
import { storedFinalUnitPrice } from "@/lib/billing-v2/board";
import { invoiceTotals, invoiceUnitPrice, roundMoney, toCents } from "@/lib/billing-v5/calculation";
import { useV5T } from "@/lib/billing-v5/i18n";
import { billingState, customerFor, unappliedProjectDeposit } from "@/lib/billing-v5/ontology";
import { phnomPenhDate } from "@/lib/exchange-rate";
import { moneyExact } from "@/lib/format";
import type { ExchangeRate, Product, Snapshot, TaxInvoiceRecord } from "@/lib/types";
import { Combobox, type ComboOption } from "./combobox";
import { FitA4 } from "./fit-a4";
import { InvoiceDocument, type InvoiceView } from "./invoice-document";

const khr = (value: number) => `${value.toLocaleString("en-US")} ៛`;

interface Row {
  key: string;
  billingItemId: string | null;
  productId: string | null;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  /** Authoritative for a billing row (the amount billed from it); qty × unit otherwise. */
  amount: string;
}

type CustomerFields = { companyNameEn: string; companyNameKm: string; addressEn: string; addressKm: string; telephone: string; vatin: string };

let keySeq = 0;
const nextKey = () => `row-${++keySeq}`;
const num = (value: string) => (value.trim() === "" ? Number.NaN : Number(value));

/** `/api/v5/exchange-rate?date=`: the NBC rate for that date, or null (enter by hand). */
type RateAnswer = { rate: ExchangeRate | null; basis: "EXACT" | "IN_EFFECT" | null; fetched: boolean | null };
const rateState = (answer: RateAnswer) =>
  answer.rate
    ? { value: String(answer.rate.rate), source: "NBC" as const, effectiveDate: answer.rate.effectiveDate, state: "found" as const }
    : { value: "", source: "MANUAL" as const, effectiveDate: null, state: answer.fetched === false ? ("failed" as const) : ("none" as const) };

function rowAmount(row: Row): number {
  if (row.billingItemId) return roundMoney(num(row.amount));
  return roundMoney(num(row.quantity) * num(row.unitPrice));
}

export type EditorProps =
  | { mode: "create"; snapshot: Snapshot; customerId: string | null; billingItemIds: string[]; onClose: () => void }
  | { mode: "edit"; snapshot: Snapshot; invoice: TaxInvoiceRecord; onClose: () => void };

export function InvoiceEditor(props: EditorProps) {
  const t = useV5T();
  const { t: t3 } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const { runResult, busy } = useAction();
  const { snapshot } = props;
  const editing = props.mode === "edit" ? props.invoice : null;
  const products = (snapshot.products ?? []).filter((product) => product.active);
  const productOptions: ComboOption[] = products.map((product) => ({
    id: product.id,
    label: product.description,
    hint: [product.productCode, product.unit, product.defaultUnitPrice == null ? "" : moneyExact(product.defaultUnitPrice)].filter(Boolean).join(" · "),
    keywords: [product.productCode],
  }));

  // What each billing line has left to bill, counting this invoice's own share back in.
  const leftFor = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of snapshot.billingItems) {
      const state = billingState(snapshot, item);
      const own = editing
        ? (snapshot.billingAllocations ?? []).filter((a) => a.invoiceId === editing.id && a.billingItemId === item.id && !a.voidedAt).reduce((sum, a) => sum + a.amount, 0)
        : 0;
      map.set(item.id, roundMoney(state.remainingUsd + own));
    }
    return map;
  }, [snapshot, editing]);

  const initialRows = (): Row[] => {
    if (editing) {
      return editing.lines.map((line) => ({
        key: nextKey(), billingItemId: line.billingItemId, productId: line.productId ?? null, description: line.description,
        quantity: String(line.quantity), unit: line.unit ?? "", unitPrice: String(line.unitPrice), amount: String(line.amount),
      }));
    }
    const ids = props.mode === "create" ? props.billingItemIds : [];
    // Started from the customer: one empty line to type or pick a product into.
    if (!ids.length) return [{ key: nextKey(), billingItemId: null, productId: null, description: "", quantity: "1", unit: "", unitPrice: "", amount: "" }];
    return ids.map((id) => {
      const item = snapshot.billingItems.find((entry) => entry.id === id)!;
      const left = leftFor.get(id) ?? 0;
      const full = left === roundMoney(item.amount ?? 0);
      const unit = full
        ? invoiceUnitPrice({ quantity: item.quantity, unitPrice: storedFinalUnitPrice(item), amount: left })
        : roundMoney(left / (item.quantity || 1));
      const label = serviceLabel(serviceForItem(item, snapshot.serviceTypes), t3);
      return {
        key: nextKey(), billingItemId: id, productId: null, description: item.description.trim() || label,
        quantity: String(item.quantity), unit: "", unitPrice: unit.toFixed(2), amount: left.toFixed(2),
      };
    });
  };

  const startCustomer = editing?.clientId ?? (props.mode === "create" ? props.customerId : null) ?? "";
  const [customerId, setCustomerId] = useState(startCustomer);
  // The invoice's own snapshot for its customer; the Customer Master for any
  // customer chosen explicitly (a new invoice, or a changed customer on edit).
  const fieldsFor = (id: string): CustomerFields => {
    if (editing && id === editing.clientId) return { ...editing.customer };
    const master = customerFor(snapshot, id);
    return { companyNameEn: master.companyNameEn, companyNameKm: master.companyNameKm, addressEn: master.addressEn, addressKm: master.addressKm, telephone: master.telephone, vatin: master.vatin };
  };
  const [customer, setCustomer] = useState<CustomerFields>(() => fieldsFor(startCustomer));
  // Active customers from the Customer Master (the current one stays listed on edit).
  const customerOptions = useMemo<ComboOption[]>(
    () =>
      snapshot.clients
        .filter((client) => (client.active && selectableClients([client]).length > 0) || client.id === startCustomer)
        .map((client) => {
          const master = customerFor(snapshot, client.id);
          return {
            id: client.id,
            label: master.customerCode ? `${master.customerCode} · ${client.name}` : client.name,
            hint: [master.companyNameEn !== client.name ? master.companyNameEn : "", master.companyNameKm].filter(Boolean).join(" · ") || undefined,
            keywords: [master.customerCode, client.name, master.companyNameEn, master.companyNameKm, master.vatin],
          };
        })
        .sort((a, b) => a.label.localeCompare(b.label)),
    [snapshot, startCustomer],
  );
  const customerLabel = (id: string) => customerOptions.find((option) => option.id === id)?.label ?? "";
  const [customerQuery, setCustomerQuery] = useState(() => customerLabel(startCustomer));
  const pickCustomer = (id: string) => {
    setCustomerId(id);
    setCustomer(fieldsFor(id));
    setCustomerQuery(customerLabel(id));
  };
  const [updateMaster, setUpdateMaster] = useState(!editing);
  const [invoiceDate, setInvoiceDate] = useState(editing?.invoiceDate ?? phnomPenhDate());
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [discountType, setDiscountType] = useState<"NONE" | "FIXED" | "PERCENT">(editing?.discount?.type ?? "NONE");
  const [discountValue, setDiscountValue] = useState(editing?.discount ? String(editing.discount.value) : "");
  const [vatApplicable, setVatApplicable] = useState(editing?.vatApplicable ?? true);
  const projectIds = [...new Set(rows.filter((r) => r.billingItemId).map((r) => snapshot.billingItems.find((i) => i.id === r.billingItemId)?.projectId).filter(Boolean) as string[])];
  const [deposit, setDeposit] = useState(() => {
    if (editing) return (editing.depositUsd ?? 0) > 0 ? String(editing.depositUsd) : "";
    const suggested = unappliedProjectDeposit(snapshot, projectIds);
    return suggested > 0 ? suggested.toFixed(2) : "";
  });
  const [rate, setRate] = useState<{ value: string; source: "NBC" | "MANUAL"; effectiveDate: string | null; state: "kept" | "loading" | "found" | "none" | "failed" }>(
    editing
      ? { value: String(editing.exchangeRate), source: editing.exchangeRateSource, effectiveDate: editing.exchangeRateEffectiveDate, state: "kept" }
      : { value: "", source: "NBC", effectiveDate: null, state: "loading" },
  );
  const [reason, setReason] = useState("");
  const [view, setView] = useState<"form" | "preview">("form");
  const [confirming, setConfirming] = useState(false);
  const [newProducts, setNewProducts] = useState<Row[] | null>(null);

  // The rate belongs to the invoice date: looked up for a new invoice and
  // whenever the date changes; an edit that keeps the date keeps its rate.
  const lookupRate = (date: string) => {
    if (editing && date === editing.invoiceDate) {
      setRate({ value: String(editing.exchangeRate), source: editing.exchangeRateSource, effectiveDate: editing.exchangeRateEffectiveDate, state: "kept" });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    setRate((current) => ({ ...current, state: "loading" }));
    api<RateAnswer>(`/api/v5/exchange-rate?date=${date}`)
      .then((result) => setRate(rateState(result)))
      .catch(() => setRate({ value: "", source: "MANUAL", effectiveDate: null, state: "failed" }));
  };
  const changeDate = (date: string) => {
    setInvoiceDate(date);
    lookupRate(date);
  };
  // A new invoice starts on today's date: look its rate up once.
  useEffect(() => {
    if (editing) return;
    let live = true;
    api<RateAnswer>(`/api/v5/exchange-rate?date=${phnomPenhDate()}`)
      .then((result) => {
        if (live) setRate((current) => (current.state !== "loading" ? current : rateState(result)));
      })
      .catch(() => live && setRate((current) => (current.state !== "loading" ? current : { value: "", source: "MANUAL", effectiveDate: null, state: "failed" })));
    return () => {
      live = false;
    };
  }, [editing]);

  // The draft shows the project name the server will snapshot (an edit keeps the printed one).
  const previewProjectName = (billingItemId: string | null | undefined) => {
    if (!billingItemId) return undefined;
    const printed = editing?.lines.find((line) => line.billingItemId === billingItemId);
    if (printed) return printed.projectName;
    const item = snapshot.billingItems.find((entry) => entry.id === billingItemId);
    return snapshot.projects.find((project) => project.id === item?.projectId)?.name.trim() || undefined;
  };
  const lines = rows.map((row) => ({ amount: Number.isFinite(rowAmount(row)) ? rowAmount(row) : 0 }));
  const rateNumber = num(rate.value);
  const discount = discountType === "NONE" ? null : { type: discountType, value: num(discountValue) };
  const totals = invoiceTotals({
    lines,
    discount: discount && Number.isFinite(discount.value) ? discount : null,
    vatApplicable,
    exchangeRate: Number.isFinite(rateNumber) ? rateNumber : 0,
    deposit: Number.isFinite(num(deposit)) ? num(deposit) : 0,
  });

  const errors: string[] = [];
  if (!customerId) errors.push(t("editor.chooseCustomer"));
  // One invoice bills one customer: billing lines of another customer block it.
  const foreign = rows.filter((row) => {
    if (!row.billingItemId || !customerId) return false;
    const item = snapshot.billingItems.find((entry) => entry.id === row.billingItemId);
    return snapshot.projects.find((project) => project.id === item?.projectId)?.clientId !== customerId;
  });
  if (foreign.length) errors.push(t("editor.otherCustomer", { count: foreign.length }));
  if (!customer.companyNameEn.trim() && !customer.companyNameKm.trim()) errors.push(t("prepare.errName"));
  if (!(rateNumber > 0)) errors.push(t("prepare.errRate"));
  if (!rows.length) errors.push(t("editor.addLine"));
  const rowError = (row: Row): string | null => {
    if (!row.description.trim()) return t3("v2.description");
    if (!(num(row.quantity) > 0)) return t("editor.qty");
    if (!(num(row.unitPrice) >= 0)) return t("editor.unitPrice");
    const amount = rowAmount(row);
    if (!Number.isFinite(amount) || amount < 0) return t("editor.amount");
    if (row.billingItemId) {
      const left = leftFor.get(row.billingItemId) ?? 0;
      const sameLine = rows.filter((other) => other.billingItemId === row.billingItemId).reduce((sum, other) => sum + (rowAmount(other) || 0), 0);
      if (toCents(sameLine) > toCents(left) || amount <= 0) return t("editor.overLimit", { left: moneyExact(left) });
    }
    return null;
  };
  if (rows.some((row) => rowError(row))) errors.push(t("editor.lines"));
  if (discount && (!(discount.value >= 0) || (discount.type === "PERCENT" && discount.value > 100) || (discount.type === "FIXED" && toCents(discount.value) > toCents(totals.discountUsd)))) errors.push(t("editor.discount"));
  if (deposit.trim() && !(num(deposit) >= 0 && toCents(num(deposit)) <= toCents(totals.totalUsd))) errors.push(t("editor.deposit"));
  const valid = errors.length === 0;

  const update = (key: string, patch: Partial<Row>) =>
    setRows((current) => current.map((row) => {
      if (row.key !== key) return row;
      const next = { ...row, ...patch };
      // A picked description that is in the Product List links the product.
      if (patch.description !== undefined && !row.billingItemId) {
        const product = products.find((entry) => entry.description.toLowerCase() === patch.description!.trim().toLowerCase());
        next.productId = product?.id ?? null;
        if (product && !row.unitPrice.trim() && product.defaultUnitPrice != null) next.unitPrice = product.defaultUnitPrice.toFixed(2);
        if (product && !row.unit.trim()) next.unit = product.unit;
      }
      // Billing a different amount keeps the unit price consistent with it.
      if (patch.amount !== undefined && row.billingItemId && num(next.quantity) > 0 && Number.isFinite(num(patch.amount))) {
        next.unitPrice = roundMoney(num(patch.amount) / num(next.quantity)).toFixed(2);
      }
      return next;
    }));

  /** Choosing a product fills the line from the Product Master; every field stays editable. */
  const pickProduct = (key: string, productId: string) => {
    const product = products.find((entry) => entry.id === productId);
    if (!product) return;
    setRows((current) => current.map((row) => (row.key !== key ? row : {
      ...row,
      productId: product.id,
      description: product.description,
      unit: product.unit,
      unitPrice: product.defaultUnitPrice == null ? row.unitPrice : product.defaultUnitPrice.toFixed(2),
    })));
  };

  const view_: InvoiceView = {
    projectId: projectIds[0] ?? "", projectIds, clientId: customerId, invoiceNumber: editing?.invoiceNumber ?? "", invoiceDate,
    status: "ISSUED", customer, project: { name: "", note: "" },
    lines: rows.map((row) => ({ billingItemId: row.billingItemId, productId: row.productId, projectName: previewProjectName(row.billingItemId), description: row.description, quantity: num(row.quantity) || 0, unit: row.unit || null, unitPrice: roundMoney(num(row.unitPrice) || 0), amount: rowAmount(row) || 0 })),
    vatApplicable, vatPercent: totals.vatPercent, subtotalUsd: totals.subtotalUsd, discount: totals.discountUsd > 0 ? discount : null,
    discountUsd: totals.discountUsd, taxableUsd: totals.taxableUsd, vatUsd: totals.vatUsd, totalUsd: totals.totalUsd,
    exchangeRate: rateNumber || 0, exchangeRateSource: rate.source, exchangeRateEffectiveDate: rate.effectiveDate, totalKhr: totals.totalKhr,
    depositUsd: totals.depositUsd, draft: !editing,
  };

  const body = (items: Row[]) => ({
    customerId,
    invoiceDate,
    customer,
    items: items.map((row) => ({
      billingItemId: row.billingItemId, productId: row.productId, description: row.description.trim(),
      quantity: num(row.quantity), unit: row.unit.trim() || null, unitPrice: num(row.unitPrice), amount: rowAmount(row),
    })),
    discount,
    vatApplicable,
    exchangeRate: rate.source === "MANUAL" ? { rate: rateNumber, source: "MANUAL" } : { rate: rateNumber, source: "NBC", effectiveDate: rate.effectiveDate },
    depositUsd: deposit.trim() ? num(deposit) : 0,
    updateCustomerMaster: updateMaster,
    reason: reason.trim() || null,
    ...(editing ? { invoiceNumber: editing.invoiceNumber } : {}),
  });

  const submit = async (items: Row[]) => {
    const saved = await runResult(() =>
      editing
        ? api<TaxInvoiceRecord>(`/api/v5/tax-invoices/${editing.id}`, { method: "PATCH", body: body(items) })
        : api<TaxInvoiceRecord>("/api/v5/tax-invoices", { method: "POST", body: body(items) }),
    );
    setConfirming(false);
    if (!saved) return;
    if (editing) {
      toast(t("editor.saved", { number: saved.invoiceNumber }));
      props.onClose();
    } else {
      toast(t("prepare.issued", { number: saved.invoiceNumber }));
      router.push(`/office-v5/tax-invoices/${saved.id}`);
    }
  };

  /**
   * Free-text lines that are not in the Product Master: asked one line at a
   * time — Yes adds that line to the Product Master, No keeps it on this
   * invoice only. Nothing is ever added without asking.
   */
  const start = () => {
    const unknown = rows.filter((row) => !row.billingItemId && !row.productId && row.description.trim());
    if (unknown.length) setNewProducts(unknown);
    else if (editing) void submit(rows);
    else setConfirming(true);
  };

  const answerProduct = async (save: boolean) => {
    const [row, ...rest] = newProducts ?? [];
    if (!row) return;
    let next = rows;
    if (save) {
      const product = await runResult(() =>
        api<Product>("/api/v5/products", { method: "POST", body: { description: row.description.trim(), defaultUnitPrice: num(row.unitPrice), unit: row.unit.trim() } }),
      );
      if (!product) return; // stays on this question; the error is shown
      next = rows.map((entry) => (entry.key === row.key ? { ...entry, productId: product.id } : entry));
      setRows(next);
    }
    if (rest.length) {
      setNewProducts(rest);
      return;
    }
    setNewProducts(null);
    if (editing) void submit(next);
    else setConfirming(true);
  };

  const title = editing ? t("editor.editTitle", { number: editing.invoiceNumber }) : t("editor.createTitle");

  const footer = (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
      <Button variant="secondary" onClick={() => (view === "preview" ? setView("form") : props.onClose())} disabled={busy} data-testid="v5-editor-back">
        {view === "preview" ? t("prepare.edit") : t3("common.cancel")}
      </Button>
      <span className="tnum ml-auto min-w-0 text-right">
        <span className="block text-[11.5px] text-muted">{totals.depositUsd > 0 ? t("totals.balanceDue") : t("prepare.totalUsd")}</span>
        <span className="block text-[18px] font-semibold leading-tight tracking-[-0.02em]" data-testid="v5-editor-total">
          {moneyExact(totals.depositUsd > 0 ? totals.balanceDueUsd : totals.totalUsd)}
        </span>
      </span>
      {view === "form" && (
        <Button variant="secondary" onClick={() => setView("preview")} disabled={!valid} data-testid="v5-preview">
          {t("prepare.preview")}
        </Button>
      )}
      <Button variant="primary" onClick={start} disabled={!valid || busy || rate.state === "loading"} data-testid="v5-issue">
        {editing ? t("editor.save") : t("prepare.issue")}
      </Button>
    </div>
  );

  return (
    <Modal open onClose={props.onClose} busy={busy} kicker={customer.companyNameEn || undefined} title={title} closeLabel={t3("common.close")} footer={footer} testId="v5-invoice-editor">
      {view === "preview" ? (
        <div className="rounded-xl bg-fill p-3 sm:p-4" data-testid="v5-preview-sheet">
          <FitA4>
            <InvoiceDocument invoice={view_} />
          </FitA4>
        </div>
      ) : (
        <div className="space-y-8" data-testid="v5-prepare-form">
          <section className="grid gap-x-8 gap-y-6 lg:grid-cols-2">
            <fieldset className="min-w-0">
              <legend className="mb-2 text-[13px] font-semibold">{t("editor.customer")}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-[12px] font-medium text-muted">{t("editor.customer")}</span>
                  <Combobox
                    value={customerQuery}
                    onInput={setCustomerQuery}
                    onBlur={() => setCustomerQuery(customerLabel(customerId))}
                    options={customerOptions}
                    onPick={pickCustomer}
                    placeholder={t("editor.searchCustomer")}
                    ariaLabel={t("editor.customer")}
                    empty={t("editor.noCustomer")}
                    testId="v5-editor-customer"
                  />
                  {foreign.length > 0 && <span className="mt-1 block text-[12px] text-danger" data-testid="v5-editor-customer-error">{t("editor.otherCustomer", { count: foreign.length })}</span>}
                </label>
                <Text label={t("prepare.nameEn")} value={customer.companyNameEn} onChange={(v) => setCustomer({ ...customer, companyNameEn: v })} testId="v5-name-en" />
                <Text label={t("prepare.nameKm")} value={customer.companyNameKm} onChange={(v) => setCustomer({ ...customer, companyNameKm: v })} testId="v5-name-km" lang="km" />
                <Text label={t("prepare.addressEn")} value={customer.addressEn} onChange={(v) => setCustomer({ ...customer, addressEn: v })} testId="v5-address-en" />
                <Text label={t("prepare.addressKm")} value={customer.addressKm} onChange={(v) => setCustomer({ ...customer, addressKm: v })} testId="v5-address-km" lang="km" />
                <Text label={t("prepare.phone")} value={customer.telephone} onChange={(v) => setCustomer({ ...customer, telephone: v })} testId="v5-phone" />
                <Text label={t("prepare.vatin")} value={customer.vatin} onChange={(v) => setCustomer({ ...customer, vatin: v })} testId="v5-vatin" />
                <label className="flex items-center gap-2.5 sm:col-span-2">
                  <Checkbox checked={updateMaster} onChange={setUpdateMaster} label={t("editor.updateMaster")} />
                  <span className="text-[13px] text-muted">{t("editor.updateMaster")}</span>
                </label>
              </div>
            </fieldset>
            <fieldset className="min-w-0">
              <legend className="mb-2 text-[13px] font-semibold">{t("prepare.invoice")}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-[12px] font-medium text-muted">{t("editor.number")}</span>
                  <span className="tnum flex h-11 items-center text-[15px] text-muted" data-testid="v5-invoice-number">
                    {editing?.invoiceNumber ?? t("editor.numberAuto")}
                  </span>
                </label>
                <Text label={t("prepare.date")} type="date" value={invoiceDate} onChange={changeDate} testId="v5-invoice-date" />
                <label className="block sm:col-span-2">
                  <span className="mb-1 flex items-baseline justify-between gap-2">
                    <span className="text-[12px] font-medium text-muted">{t("prepare.rate")}</span>
                    <span className="text-[11.5px] text-faint" data-testid="v5-rate-source">
                      {rate.state === "kept"
                        ? t("editor.rateKept")
                        : rate.source === "NBC" && rate.effectiveDate
                          ? t("prepare.rateNbc", { date: rate.effectiveDate })
                          : t("prepare.rateManual")}
                    </span>
                  </span>
                  <Input
                    inputMode="decimal"
                    value={rate.value}
                    disabled={rate.state === "kept" || rate.state === "loading" || rate.state === "found"}
                    onChange={(event) => setRate((current) => ({ value: event.target.value, source: "MANUAL", effectiveDate: null, state: current.state }))}
                    aria-invalid={!(rateNumber > 0) || undefined}
                    className={`tnum text-right ${!(rateNumber > 0) && rate.state !== "loading" ? "!border-danger" : ""}`}
                    data-testid="v5-rate-input"
                  />
                  {(rate.state === "none" || rate.state === "failed") && (
                    <span className="mt-1 block text-[12px] text-pending" data-testid="v5-rate-none">
                      {t(rate.state === "failed" ? "editor.rateFailed" : "editor.rateNone", { date: invoiceDate })}
                    </span>
                  )}
                </label>
                <label className="flex items-center gap-2.5 sm:col-span-2">
                  <Checkbox checked={vatApplicable} onChange={setVatApplicable} label={t("prepare.vat")} />
                  <span className="text-[13.5px]">{t("prepare.vat")}</span>
                </label>
              </div>
            </fieldset>
          </section>

          <section>
            <h3 className="mb-1 text-[13px] font-semibold">{t("editor.lines")}</h3>
            <div className="border-t border-line">
              <div className="hidden grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_6.5rem_7rem_2rem] gap-x-2 border-b border-line py-2 text-[11px] font-medium uppercase tracking-[0.06em] text-faint sm:grid">
                <span>{t("editor.description")}</span>
                <span className="text-right">{t("editor.qty")}</span>
                <span>{t("editor.unit")}</span>
                <span className="text-right">{t("editor.unitPrice")}</span>
                <span className="text-right">{t("editor.amount")}</span>
                <span />
              </div>
              {rows.map((row, index) => {
                const item = row.billingItemId ? snapshot.billingItems.find((entry) => entry.id === row.billingItemId) : undefined;
                const project = item ? snapshot.projects.find((entry) => entry.id === item.projectId) : undefined;
                const problem = rowError(row);
                return (
                  <div key={row.key} className="grid grid-cols-[minmax(0,1fr)_2rem] gap-x-2 gap-y-2 border-b border-line py-3 sm:grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_6.5rem_7rem_2rem] sm:items-start" data-testid="v5-editor-row">
                    <div className="min-w-0">
                      {row.billingItemId ? (
                        <Input value={row.description} onChange={(event) => update(row.key, { description: event.target.value })} aria-label={t("editor.description")} data-testid={`v5-row-description-${index}`} />
                      ) : (
                        <Combobox
                          value={row.description}
                          onInput={(text) => update(row.key, { description: text })}
                          options={productOptions}
                          onPick={(id) => pickProduct(row.key, id)}
                          placeholder={t("editor.searchProduct")}
                          ariaLabel={t("editor.description")}
                          testId={`v5-row-description-${index}`}
                        />
                      )}
                      <span className="mt-1 block text-[12px] text-faint">
                        {item ? t("editor.fromBilling", { project: project?.name ?? "", left: moneyExact(leftFor.get(item.id) ?? 0) }) : row.productId ? products.find((p) => p.id === row.productId)?.productCode : t("detail.freeLine")}
                      </span>
                      {problem && <span className="mt-0.5 block text-[12px] text-danger" data-testid={`v5-row-error-${index}`}>{problem}</span>}
                    </div>
                    <button type="button" onClick={() => setRows((current) => current.filter((entry) => entry.key !== row.key))} aria-label={t("editor.removeLine")} className="h-11 text-[18px] text-faint hover:text-danger sm:order-last" data-testid={`v5-row-remove-${index}`}>×</button>
                    <div className="col-span-2 grid grid-cols-4 gap-2 sm:contents">
                      <Input inputMode="decimal" value={row.quantity} onChange={(event) => update(row.key, { quantity: event.target.value })} aria-label={t("editor.qty")} className="tnum text-right" data-testid={`v5-row-qty-${index}`} />
                      <Input value={row.unit} onChange={(event) => update(row.key, { unit: event.target.value })} aria-label={t("editor.unit")} data-testid={`v5-row-unit-${index}`} />
                      <Input inputMode="decimal" value={row.unitPrice} onChange={(event) => update(row.key, { unitPrice: event.target.value })} aria-label={t("editor.unitPrice")} className="tnum text-right" disabled={!!row.billingItemId} data-testid={`v5-row-price-${index}`} />
                      {row.billingItemId ? (
                        <Input inputMode="decimal" value={row.amount} onChange={(event) => update(row.key, { amount: event.target.value })} aria-label={t("editor.amount")} className="tnum text-right font-medium" data-testid={`v5-row-amount-${index}`} />
                      ) : (
                        <span className="tnum flex h-11 items-center justify-end text-[15px] font-medium" data-testid={`v5-row-amount-${index}`}>
                          {Number.isFinite(rowAmount(row)) ? moneyExact(rowAmount(row)) : "—"}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setRows((current) => [...current, { key: nextKey(), billingItemId: null, productId: null, description: "", quantity: "1", unit: "", unitPrice: "", amount: "" }])}
              className="mt-3 inline-flex h-9 items-center gap-1.5 text-[13.5px] font-medium text-accent hover:underline"
              data-testid="v5-add-line"
            >
              <span aria-hidden className="text-[17px] leading-none">+</span>
              {t("editor.addLine")}
            </button>
          </section>

          <section className="grid gap-6 border-t border-line pt-5 sm:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="grid content-start gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-muted">{t("editor.discount")}</span>
                <Select value={discountType} onChange={(event) => setDiscountType(event.target.value as typeof discountType)} data-testid="v5-discount-type">
                  <option value="NONE">{t("editor.discountNone")}</option>
                  <option value="FIXED">{t("editor.discountFixed")}</option>
                  <option value="PERCENT">{t("editor.discountPercent")}</option>
                </Select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-muted">&nbsp;</span>
                <Input inputMode="decimal" value={discountValue} disabled={discountType === "NONE"} onChange={(event) => setDiscountValue(event.target.value)} className="tnum text-right" aria-label={t("editor.discount")} data-testid="v5-discount-value" />
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-[12px] font-medium text-muted">{t("editor.deposit")}</span>
                <Input inputMode="decimal" value={deposit} placeholder="0.00" onChange={(event) => setDeposit(event.target.value)} className="tnum text-right" data-testid="v5-deposit" />
                <span className="mt-1 block text-[12px] text-faint">{t("editor.depositHint")}</span>
              </label>
              {editing && (
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-[12px] font-medium text-muted">{t("editor.reason")}</span>
                  <Input value={reason} onChange={(event) => setReason(event.target.value)} data-testid="v5-edit-reason" />
                </label>
              )}
              {errors.length > 0 && <p className="text-[12.5px] text-danger sm:col-span-2" data-testid="v5-prepare-error">{errors.join(" · ")}</p>}
              {!customer.vatin.trim() && <p className="text-[12.5px] text-pending sm:col-span-2" data-testid="v5-warn-vatin">{t("prepare.warnVatin")}</p>}
            </div>
            <dl className="tnum space-y-1.5 text-[13.5px]" data-testid="v5-totals">
              <Line label={t("prepare.subtotal")} value={moneyExact(totals.subtotalUsd)} testId="v5-subtotal" />
              {totals.discountUsd > 0 && (
                <>
                  <Line label={t("totals.discount")} value={`−${moneyExact(totals.discountUsd)}`} testId="v5-discount" />
                  <Line label={t("totals.taxable")} value={moneyExact(totals.taxableUsd)} testId="v5-taxable" />
                </>
              )}
              <Line label={t("prepare.vatLine", { percent: totals.vatPercent })} value={moneyExact(totals.vatUsd)} testId="v5-vat" />
              <Line label={t("prepare.totalUsd")} value={moneyExact(totals.totalUsd)} strong testId="v5-total-usd" />
              <Line label={t("prepare.totalKhr")} value={rateNumber > 0 ? khr(totals.totalKhr) : "—"} strong testId="v5-total-khr" />
              {totals.depositUsd > 0 && (
                <>
                  <Line label={t("totals.deposit")} value={`−${moneyExact(totals.depositUsd)}`} testId="v5-deposit-line" />
                  <Line label={t("totals.balanceDue")} value={moneyExact(totals.balanceDueUsd)} strong testId="v5-balance-due" />
                </>
              )}
            </dl>
          </section>
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => void submit(rows)}
        busy={busy}
        title={t("prepare.confirmTitle")}
        message={t("prepare.confirmBody", { number: t("editor.numberAuto"), total: moneyExact(totals.totalUsd) })}
        confirmLabel={t("prepare.issue")}
        testId="v5-confirm-issue"
      />
      <ConfirmDialog
        open={!!newProducts?.length}
        onClose={() => void answerProduct(false)}
        onConfirm={() => void answerProduct(true)}
        busy={busy}
        title={t("editor.newProducts")}
        message={t("editor.newProductsBody", { name: newProducts?.[0]?.description.trim() ?? "" })}
        confirmLabel={t("editor.saveProducts")}
        cancelLabel={t("editor.keepOnInvoice")}
        testId="v5-confirm-products"
      />
    </Modal>
  );
}

function Line({ label, value, strong = false, testId }: { label: string; value: string; strong?: boolean; testId?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className={strong ? "text-[15px] font-semibold" : "font-medium"} data-testid={testId}>{value}</dd>
    </div>
  );
}

function Text({ label, value, onChange, testId, type = "text", lang }: { label: string; value: string; onChange: (value: string) => void; testId: string; type?: string; lang?: string }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[12px] font-medium text-muted">{label}</span>
      <Input type={type} value={value} lang={lang} onChange={(event) => onChange(event.target.value)} data-testid={testId} />
    </label>
  );
}

