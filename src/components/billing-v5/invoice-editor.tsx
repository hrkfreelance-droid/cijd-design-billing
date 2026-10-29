"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { ConfirmDialog } from "@/components/billing-v2/confirm-dialog";
import { Modal } from "@/components/billing-v2/modal";
import { api, useI18n, useToast } from "@/components/providers";
import { Button, Checkbox, Input, Select } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { selectableClients } from "@/lib/billing-v2/board";
import { serviceForItem, serviceLabel } from "@/lib/billing-v2/services";
import { storedFinalUnitPrice } from "@/lib/billing-v2/board";
import { fromCents, invoiceTotals, invoiceUnitPrice, nextTaxInvoiceNumber, nextTestTaxInvoiceNumber, roundMoney, toCents, totalKhrForCents } from "@/lib/billing-v5/calculation";
import { allocateCentsProportionally, cumulativeVatSliceCents, percentageOfCents } from "@/lib/billing-v5/deposit";
import { useV5T, type V5Key } from "@/lib/billing-v5/i18n";
import { billingState, customerFor, unappliedProjectDeposit } from "@/lib/billing-v5/ontology";
import { phnomPenhDate } from "@/lib/exchange-rate";
import { moneyExact } from "@/lib/format";
import { MAX_INVOICE_ITEMS, additionalInvoiceRows } from "@/lib/billing-v5/invoice-limits";
import type { ExchangeRate, Product, Snapshot, TaxInvoiceContractSnapshot, TaxInvoiceDepositReference, TaxInvoiceKind, TaxInvoiceRecord } from "@/lib/types";
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
const blankRow = (): Row => ({
  key: nextKey(), billingItemId: null, productId: null, description: "",
  quantity: "1", unit: "", unitPrice: "", amount: "",
});
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

function isDepositKind(kind: TaxInvoiceKind): kind is "DEPOSIT_FIXED" | "DEPOSIT_PERCENT" {
  return kind === "DEPOSIT_FIXED" || kind === "DEPOSIT_PERCENT";
}

function contractRemainingCents(snapshot: Snapshot, contract: TaxInvoiceContractSnapshot, excludeInvoiceId: string | null = null): Map<string, number> {
  const invoiceIds = new Set((snapshot.taxInvoices ?? [])
    .filter((invoice) => invoice.contractId === contract.id && invoice.status === "ISSUED" && invoice.id !== excludeInvoiceId)
    .map((invoice) => invoice.id));
  return new Map(contract.lines.map((line) => {
    const allocated = (snapshot.billingAllocations ?? [])
      .filter((allocation) => allocation.billingItemId === line.billingItemId && !allocation.voidedAt && allocation.invoiceId !== excludeInvoiceId && invoiceIds.has(allocation.invoiceId))
      .reduce((sum, allocation) => sum + toCents(allocation.amount), 0);
    return [line.billingItemId, Math.max(toCents(line.amount) - allocated, 0)];
  }));
}

function contractRows(snapshot: Snapshot, contract: TaxInvoiceContractSnapshot, excludeInvoiceId: string | null = null): Row[] {
  const remainingById = contractRemainingCents(snapshot, contract, excludeInvoiceId);
  return contract.lines.flatMap((line) => {
    const remainingCents = remainingById.get(line.billingItemId) ?? 0;
    if (remainingCents <= 0) return [];
    const remaining = fromCents(remainingCents);
    return [{
      key: nextKey(), billingItemId: line.billingItemId, productId: null, description: line.description,
      quantity: "1", unit: "balance", unitPrice: remaining.toFixed(2), amount: remaining.toFixed(2),
    }];
  });
}

function contractDepositReferences(snapshot: Snapshot, contractId: string, excludeInvoiceId: string | null = null): TaxInvoiceDepositReference[] {
  return (snapshot.taxInvoices ?? [])
    .filter((invoice) => invoice.contractId === contractId && invoice.status === "ISSUED" && invoice.id !== excludeInvoiceId && isDepositKind(invoice.invoiceKind ?? "FULL"))
    .sort((a, b) => a.issuedAt.localeCompare(b.issuedAt) || a.invoiceNumber.localeCompare(b.invoiceNumber))
    .map((invoice) => ({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      subtotalUsd: invoice.subtotalUsd,
      vatUsd: invoice.vatUsd,
      totalUsd: invoice.totalUsd,
      allocations: invoice.lines.filter((line) => line.billingItemId).map((line) => ({
        billingItemId: line.billingItemId!,
        description: line.description.replace(/^Advance portion: /, ""),
        amount: line.amount,
      })),
    }));
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
  const [invoiceKind, setInvoiceKind] = useState<TaxInvoiceKind>(editing?.invoiceKind ?? "FULL");
  const [contractId, setContractId] = useState(editing?.contractId ?? "");
  const [depositValue, setDepositValue] = useState(editing?.depositValue == null ? "" : String(editing.depositValue));
  const requestKey = useRef<string | null>(null);
  const requestSignature = useRef<string | null>(null);
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
      if (editing.contractSnapshot && (editing.invoiceKind ?? "FULL") !== "FULL") {
        return contractRows(snapshot, editing.contractSnapshot, editing.id);
      }
      return editing.lines.map((line) => ({
        key: nextKey(), billingItemId: line.billingItemId, productId: line.productId ?? null, description: line.description,
        quantity: String(line.quantity), unit: line.unit ?? "", unitPrice: String(line.unitPrice), amount: String(line.amount),
      }));
    }
    const ids = props.mode === "create" ? props.billingItemIds : [];
    // Started from the customer: one empty line to type or pick a product into.
    if (!ids.length) return [blankRow()];
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
  const contractOptions = useMemo(() => {
    const grouped = new Map<string, TaxInvoiceContractSnapshot>();
    for (const invoice of snapshot.taxInvoices ?? []) {
      if (invoice.status === "ISSUED" && isDepositKind(invoice.invoiceKind ?? "FULL") && invoice.contractId && invoice.contractSnapshot && invoice.clientId === customerId) {
        grouped.set(invoice.contractId, invoice.contractSnapshot);
      }
    }
    return [...grouped.entries()].flatMap(([id, contract]) => {
      const siblings = (snapshot.taxInvoices ?? []).filter((invoice) => invoice.contractId === id && invoice.status === "ISSUED");
      const hasFinal = siblings.some((invoice) => invoice.invoiceKind === "FINAL");
      if (hasFinal && editing?.contractId !== id) return [];
      const remainingRows = contractRows(snapshot, contract, editing?.contractId === id ? editing.id : null);
      const remainingUsd = remainingRows.reduce((sum, row) => sum + rowAmount(row), 0);
      if (remainingUsd <= 0 && editing?.contractId !== id) return [];
      const firstNumber = siblings.filter((invoice) => isDepositKind(invoice.invoiceKind ?? "FULL")).sort((a, b) => a.issuedAt.localeCompare(b.issuedAt))[0]?.invoiceNumber ?? id;
      return [{ id, contract, remainingUsd, firstNumber }];
    });
  }, [snapshot, customerId, editing]);
  const selectedContract = contractOptions.find((option) => option.id === contractId)?.contract
    ?? (editing?.contractId === contractId ? editing.contractSnapshot : undefined)
    ?? (snapshot.taxInvoices ?? []).find((invoice) =>
      invoice.status === "ISSUED" && invoice.contractId === contractId && invoice.clientId === customerId && invoice.contractSnapshot,
    )?.contractSnapshot;
  const depositBillingOptions = useMemo<ComboOption[]>(() => snapshot.billingItems
    .filter((item) => {
      const project = snapshot.projects.find((entry) => entry.id === item.projectId);
      const hasAllocation = (snapshot.billingAllocations ?? []).some((allocation) => allocation.billingItemId === item.id && !allocation.voidedAt);
      return project?.clientId === customerId && billingState(snapshot, item).eligible && !hasAllocation;
    })
    .map((item) => {
      const project = snapshot.projects.find((entry) => entry.id === item.projectId);
      const left = leftFor.get(item.id) ?? 0;
      return { id: item.id, label: item.description, hint: `${project?.name ?? ""} · ${moneyExact(left)} remaining`, keywords: [project?.name ?? ""] };
    }), [snapshot, customerId, leftFor]);
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
    setContractId("");
    setNumberOverride(null);
    setCustomer(fieldsFor(id));
    setCustomerQuery(customerLabel(id));
  };
  const [updateMaster, setUpdateMaster] = useState(!editing);
  const [invoiceDate, setInvoiceDate] = useState(editing?.invoiceDate ?? phnomPenhDate());
  // Null means follow the latest automatic sequence; a typed value is a manual override.
  const [numberOverride, setNumberOverride] = useState<string | null>(null);
  const year = Number(invoiceDate.slice(0, 4));
  const testCustomer = /^TEST\b/i.test(snapshot.clients.find((client) => client.id === customerId)?.name ?? "");
  const usedNumbers = [
    ...(snapshot.taxInvoices ?? []).map((invoice) => invoice.invoiceNumber),
    ...snapshot.invoices.map((invoice) => invoice.invoiceNumber ?? ""),
  ];
  const suggestedNumber = testCustomer ? nextTestTaxInvoiceNumber(year, usedNumbers) : nextTaxInvoiceNumber(year, usedNumbers);
  const selectedNumber = numberOverride ?? suggestedNumber;
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [billingChoice, setBillingChoice] = useState("");
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

  const chooseInvoiceKind = (kind: TaxInvoiceKind) => {
    setInvoiceKind(kind);
    if (kind === "FULL") {
      setContractId("");
      setRows(initialRows());
      return;
    }
    setDiscountType("NONE");
    setDiscountValue("");
    setDeposit("");
    if (kind === "FINAL") setDepositValue("");
    if (contractId) setRows(initialRows());
    setContractId("");
  };

  const chooseContract = (id: string) => {
    setContractId(id);
    const option = contractOptions.find((entry) => entry.id === id);
    if (!option) {
      if (id === "") {
        setRows(initialRows());
        setVatApplicable(true);
        setBillingChoice("");
      }
      return;
    }
    setRows(contractRows(snapshot, option.contract));
    setVatApplicable(option.contract.vatApplicable);
    setDiscountType("NONE");
    setDiscountValue("");
    setDeposit("");
    if (invoiceKind === "DEPOSIT_FIXED" || invoiceKind === "DEPOSIT_PERCENT") setDepositValue("");
  };

  const addLinkedBillingLine = (id: string) => {
    const item = snapshot.billingItems.find((entry) => entry.id === id);
    if (!item || rows.some((row) => row.billingItemId === id)) return;
    const left = leftFor.get(id) ?? 0;
    const unitPrice = invoiceUnitPrice({ quantity: item.quantity, unitPrice: storedFinalUnitPrice(item), amount: left });
    const label = serviceLabel(serviceForItem(item, snapshot.serviceTypes), t3);
    setRows((current) => [
      ...current.filter((row) => row.billingItemId),
      { key: nextKey(), billingItemId: id, productId: null, description: item.description.trim() || label, quantity: String(item.quantity), unit: "", unitPrice: unitPrice.toFixed(2), amount: left.toFixed(2) },
    ]);
    setBillingChoice("");
  };

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
  const special = invoiceKind !== "FULL";
  const rateNumber = num(rate.value);
  // The lookup is asynchronous. Keep draft arithmetic renderable while it is
  // pending; KHR stays blank and issuing remains disabled until a real rate exists.
  const calculationRate = rateNumber > 0 ? rateNumber : 1;
  const discount = discountType === "NONE" ? null : { type: discountType, value: num(discountValue) };
  const normalTotals = invoiceTotals({
    lines: rows.map((row) => ({ amount: Number.isFinite(rowAmount(row)) ? rowAmount(row) : 0 })),
    discount: discount && Number.isFinite(discount.value) ? discount : null,
    vatApplicable,
    exchangeRate: calculationRate,
    deposit: Number.isFinite(num(deposit)) ? num(deposit) : 0,
  });
  const references = contractId ? contractDepositReferences(snapshot, contractId, editing?.id ?? null) : [];
  const sourceLineIds = new Set<string>();
  const sourceLines = selectedContract?.lines ?? rows.flatMap((row) => {
    if (!row.billingItemId || sourceLineIds.has(row.billingItemId)) return [];
    sourceLineIds.add(row.billingItemId);
    const item = snapshot.billingItems.find((entry) => entry.id === row.billingItemId);
    if (!item) return [];
    const projectName = previewProjectName(item.id);
    return [{
      billingItemId: item.id,
      description: item.description,
      ...(projectName ? { projectName } : {}),
      quantity: item.quantity > 0 ? item.quantity : 1,
      unit: null,
      unitPrice: invoiceUnitPrice({ quantity: item.quantity, unitPrice: item.unitPrice, amount: item.amount ?? 0 }),
      amount: leftFor.get(item.id) ?? 0,
    }];
  });
  const remainingById = selectedContract
    ? contractRemainingCents(snapshot, selectedContract, editing?.id ?? null)
    : new Map(sourceLines.map((line) => [line.billingItemId, toCents(line.amount)]));
  const remainingBaseCents = sourceLines.reduce((sum, line) => sum + (remainingById.get(line.billingItemId) ?? 0), 0);
  const contractBaseCents = selectedContract
    ? toCents(selectedContract.subtotalUsd)
    : sourceLines.reduce((sum, line) => sum + toCents(line.amount), 0);
  const contractVatCents = selectedContract
    ? toCents(selectedContract.vatUsd)
    : toCents(invoiceTotals({ lines: sourceLines, vatApplicable, exchangeRate: calculationRate }).vatUsd);
  const previousBaseCents = references.reduce((sum, reference) => sum + toCents(reference.subtotalUsd), 0);
  const previousVatCents = references.reduce((sum, reference) => sum + toCents(reference.vatUsd), 0);
  let displayLines: InvoiceView["lines"] = rows.map((row) => ({
    billingItemId: row.billingItemId, productId: row.productId, projectName: previewProjectName(row.billingItemId), description: row.description,
    quantity: num(row.quantity) || 0, unit: row.unit || null, unitPrice: roundMoney(num(row.unitPrice) || 0), amount: rowAmount(row) || 0,
  }));
  let totals = normalTotals;
  let contractSnapshotForView = selectedContract;
  const specialTotal = (subtotalCents: number, vatCents: number, vatPercent: number) => {
    const totalCents = subtotalCents + vatCents;
    const subtotal = fromCents(subtotalCents);
    const total = fromCents(totalCents);
    return {
      subtotalUsd: subtotal, discountUsd: 0, taxableUsd: subtotal, vatPercent, vatUsd: fromCents(vatCents),
      totalUsd: total, totalKhr: totalKhrForCents(totalCents, calculationRate), depositUsd: 0, balanceDueUsd: total, discountPolicy: null,
    };
  };
  let specialValueValid = true;
  let targetDepositCents = 0;
  if (special) {
    if (!contractSnapshotForView) {
      const contractTotals = invoiceTotals({ lines: sourceLines, vatApplicable, exchangeRate: calculationRate });
      contractSnapshotForView = {
        id: "DRAFT-CONTRACT",
        clientId: customerId,
        lines: sourceLines,
        subtotalUsd: fromCents(contractBaseCents),
        vatApplicable,
        vatPercent: contractTotals.vatPercent,
        vatUsd: fromCents(contractVatCents),
        totalUsd: fromCents(contractBaseCents + contractVatCents),
      };
    }
    if (invoiceKind === "FINAL") {
      const vatCents = contractVatCents - previousVatCents;
      displayLines = sourceLines.flatMap((line) => {
        const cents = remainingById.get(line.billingItemId) ?? 0;
        if (cents <= 0) return [];
        const amount = fromCents(cents);
        return [{ billingItemId: line.billingItemId, productId: null, projectName: line.projectName, description: `Final remainder: ${line.description}`, quantity: 1, unit: "remainder", unitPrice: amount, amount }];
      });
      totals = specialTotal(remainingBaseCents, vatCents, contractSnapshotForView.vatPercent);
    } else {
      const value = num(depositValue);
      try {
        if (!Number.isFinite(value) || value <= 0 || (invoiceKind === "DEPOSIT_PERCENT" && value >= 100)) {
          specialValueValid = false;
        } else {
          targetDepositCents = invoiceKind === "DEPOSIT_FIXED" ? toCents(value) : percentageOfCents(remainingBaseCents, value);
          specialValueValid = targetDepositCents > 0 && targetDepositCents < remainingBaseCents;
        }
      } catch {
        specialValueValid = false;
      }
      if (specialValueValid) {
        try {
          const allocation = allocateCentsProportionally(targetDepositCents, sourceLines.map((line) => ({ id: line.billingItemId, cents: remainingById.get(line.billingItemId) ?? 0 })));
          const vatCents = cumulativeVatSliceCents(contractVatCents, Math.max(contractBaseCents, 1), previousBaseCents, targetDepositCents, previousVatCents);
          displayLines = sourceLines.flatMap((line) => {
            const cents = allocation.get(line.billingItemId) ?? 0;
            if (cents <= 0) return [];
            const amount = fromCents(cents);
            return [{ billingItemId: line.billingItemId, productId: null, projectName: line.projectName, description: `Advance portion: ${line.description}`, quantity: 1, unit: "advance", unitPrice: amount, amount }];
          });
          totals = specialTotal(targetDepositCents, vatCents, contractSnapshotForView.vatPercent);
        } catch {
          specialValueValid = false;
        }
      }
    }
  }

  const errors: string[] = [];
  if (!editing && numberOverride?.trim() && (testCustomer || !new RegExp(`^CIJDTI${year}\\d{3,}$`).test(numberOverride.trim()))) {
    errors.push(t("editor.number"));
  }
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
  if (rows.length > MAX_INVOICE_ITEMS) errors.push(t("editor.lineCount", { count: rows.length, max: MAX_INVOICE_ITEMS }));
  const specialIds = rows.flatMap((row) => row.billingItemId ? [row.billingItemId] : []);
  const specialRowsInvalid = specialIds.length !== rows.length || new Set(specialIds).size !== specialIds.length;
  if (special && (specialRowsInvalid || specialIds.length === 0)) errors.push(t("editor.depositLinkedOnly"));
  if (special && isDepositKind(invoiceKind) && !contractId && rows.some((row) => row.billingItemId && (snapshot.billingAllocations ?? []).some((allocation) => allocation.billingItemId === row.billingItemId && !allocation.voidedAt))) {
    errors.push(t("editor.depositNewConflict"));
  }
  if (special && !selectedContract && (invoiceKind === "FINAL" || Boolean(contractId))) errors.push(t("editor.contractChoose"));
  if (special && invoiceKind === "FINAL" && remainingBaseCents <= 0) errors.push(t("editor.contractChoose"));
  if (special && isDepositKind(invoiceKind) && !specialValueValid) errors.push(t("editor.depositValueError"));
  const rowError = (row: Row): string | null => {
    if (special) return row.billingItemId ? null : t("editor.depositLinkedOnly");
    if (!row.description.trim()) return t3("v2.description");
    if (!(num(row.quantity) > 0)) return t("editor.qty");
    if (!(num(row.unitPrice) >= 0)) return t("editor.unitPrice");
    const contractInvoice = row.billingItemId && (snapshot.taxInvoices ?? []).find((invoice) =>
      invoice.status === "ISSUED" && (invoice.invoiceKind ?? "FULL") !== "FULL" &&
      invoice.contractSnapshot?.lines.some((line) => line.billingItemId === row.billingItemId),
    );
    if (contractInvoice) return t("editor.activeContractConflict", { number: contractInvoice.invoiceNumber });
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
  if (!special && discount && (!(discount.value >= 0) || (discount.type === "PERCENT" && discount.value > 100) || (discount.type === "FIXED" && toCents(discount.value) > toCents(totals.discountUsd)))) errors.push(t("editor.discount"));
  if (!special && deposit.trim() && !(num(deposit) >= 0 && toCents(num(deposit)) <= toCents(totals.totalUsd))) errors.push(t("editor.deposit"));
  const valid = errors.length === 0;
  const removalLocked = special && (Boolean(contractId) || invoiceKind === "FINAL" || Boolean(editing));

  const addBlankRows = (count: number) => setRows((current) => [
    ...current,
    ...Array.from({ length: additionalInvoiceRows(current.length, count) }, blankRow),
  ]);

  // Only free-text/product lines can be duplicated. Linked billing allocations
  // must never be copied, because that could bill the same job twice.
  const duplicateRow = (key: string) => setRows((current) => {
    if (current.length >= MAX_INVOICE_ITEMS) return current;
    return current.flatMap((row) => row.key === key && !row.billingItemId
      ? [row, { ...row, key: nextKey() }]
      : [row]);
  });

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
    projectId: projectIds[0] ?? "", projectIds, clientId: customerId, invoiceNumber: editing?.invoiceNumber ?? selectedNumber, invoiceDate,
    status: "ISSUED", customer, project: { name: "", note: "" },
    lines: displayLines,
    vatApplicable, vatPercent: totals.vatPercent, subtotalUsd: totals.subtotalUsd, discount: totals.discountUsd > 0 ? discount : null,
    discountUsd: totals.discountUsd, taxableUsd: totals.taxableUsd, vatUsd: totals.vatUsd, totalUsd: totals.totalUsd,
    exchangeRate: rateNumber || 0, exchangeRateSource: rate.source, exchangeRateEffectiveDate: rate.effectiveDate, totalKhr: totals.totalKhr,
    depositUsd: totals.depositUsd,
    invoiceKind,
    ...(contractId ? { contractId } : {}),
    ...(contractSnapshotForView ? { contractSnapshot: contractSnapshotForView } : {}),
    ...(isDepositKind(invoiceKind) && Number.isFinite(num(depositValue)) ? { depositValue: num(depositValue) } : {}),
    ...(special ? { depositReferences: references } : {}),
    draft: !editing,
  };

  const body = (items: Row[]) => ({
    customerId,
    invoiceDate,
    invoiceKind,
    ...(special ? { contractId: contractId || null } : {}),
    ...(isDepositKind(invoiceKind) ? { depositValue: num(depositValue) } : {}),
    customer,
    items: items.map((row) => ({
      billingItemId: row.billingItemId, productId: row.productId, description: row.description.trim(),
      quantity: num(row.quantity), unit: row.unit.trim() || null, unitPrice: num(row.unitPrice), amount: rowAmount(row),
    })),
    discount: special ? null : discount,
    vatApplicable,
    exchangeRate: rate.source === "MANUAL" ? { rate: rateNumber, source: "MANUAL" } : { rate: rateNumber, source: "NBC", effectiveDate: rate.effectiveDate },
    depositUsd: special ? 0 : deposit.trim() ? num(deposit) : 0,
    ...(!editing && requestKey.current ? { requestKey: requestKey.current } : {}),
    updateCustomerMaster: updateMaster,
    reason: reason.trim() || null,
    ...(editing ? { invoiceNumber: editing.invoiceNumber } : numberOverride === null ? {} : { invoiceNumber: numberOverride.trim() }),
  });

  const submit = async (items: Row[]) => {
    const payload = body(items);
    if (!editing) {
      const signature = JSON.stringify({
        customerId: payload.customerId,
        invoiceDate: payload.invoiceDate,
        customer: payload.customer,
        items: payload.items,
        discount: payload.discount,
        vatApplicable: payload.vatApplicable,
        exchangeRate: payload.exchangeRate,
        depositUsd: payload.depositUsd,
        invoiceKind: payload.invoiceKind,
        depositValue: payload.depositValue ?? null,
        contractId: payload.contractId ?? null,
        note: null,
        invoiceNumber: payload.invoiceNumber ?? null,
      });
      if (!requestKey.current || requestSignature.current !== signature) {
        requestKey.current = globalThis.crypto.randomUUID();
        requestSignature.current = signature;
      }
      payload.requestKey = requestKey.current;
    }
    const saved = await runResult(() =>
      editing
        ? api<TaxInvoiceRecord>(`/api/v5/tax-invoices/${editing.id}`, { method: "PATCH", body: payload })
        : api<TaxInvoiceRecord>("/api/v5/tax-invoices", { method: "POST", body: payload }),
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
                    disabled={!!editing && special}
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
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-[12px] font-medium text-muted">{t("editor.invoiceKind")}</span>
                  {editing ? (
                    <span className="flex h-11 items-center text-[14px] font-medium" data-testid="v5-invoice-kind">{t(`editor.kind.${invoiceKind}` as V5Key)}</span>
                  ) : (
                    <Select value={invoiceKind} onChange={(event) => chooseInvoiceKind(event.target.value as TaxInvoiceKind)} data-testid="v5-invoice-kind">
                      <option value="FULL">{t("editor.kind.FULL")}</option>
                      <option value="DEPOSIT_FIXED">{t("editor.kind.DEPOSIT_FIXED")}</option>
                      <option value="DEPOSIT_PERCENT">{t("editor.kind.DEPOSIT_PERCENT")}</option>
                      <option value="FINAL">{t("editor.kind.FINAL")}</option>
                    </Select>
                  )}
                </label>
                {special && (
                  <label className="block sm:col-span-2">
                    <span className="mb-1 block text-[12px] font-medium text-muted">{t("editor.contract")}</span>
                    <Select value={contractId} disabled={!!editing} onChange={(event) => chooseContract(event.target.value)} data-testid="v5-contract-select">
                      <option value="">{invoiceKind === "FINAL" ? t("editor.contractChoose") : t("editor.contractNew")}</option>
                      {contractOptions.map((option) => (
                        <option key={option.id} value={option.id}>{option.firstNumber} · {t("editor.contractRemaining")} {moneyExact(option.remainingUsd)}</option>
                      ))}
                    </Select>
                    {selectedContract ? (
                      <span className="mt-1 block text-[11.5px] text-faint">
                        {t("editor.contractRemaining")}: {moneyExact(remainingBaseCents / 100)} · {t("editor.contractVatLocked")}
                      </span>
                    ) : invoiceKind === "FINAL" && contractOptions.length === 0 ? (
                      <span className="mt-1 block text-[11.5px] text-faint">{t("editor.contractEmpty")}</span>
                    ) : null}
                  </label>
                )}
                <label className="block">
                  <span className="mb-1 block text-[12px] font-medium text-muted">{t("editor.number")}</span>
                  {editing ? (
                    <span className="tnum flex h-11 items-center text-[15px] text-muted" data-testid="v5-invoice-number">{editing.invoiceNumber}</span>
                  ) : (
                    <>
                      <Input
                        value={selectedNumber}
                        onChange={(event) => setNumberOverride(event.target.value)}
                        className="tnum"
                        data-testid="v5-invoice-number"
                        aria-invalid={errors.includes(t("editor.number")) || undefined}
                        disabled={testCustomer}
                      />
                      <span className="mt-1 block text-[11.5px] text-faint">{t("editor.numberAuto")}</span>
                    </>
                  )}
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
                  <Checkbox checked={vatApplicable} onChange={setVatApplicable} label={t("prepare.vat")} disabled={!!selectedContract} />
                  <span className="text-[13.5px]">{t("prepare.vat")}</span>
                  {selectedContract && <span className="text-[11.5px] text-faint">{t("editor.contractVatLocked")}</span>}
                </label>
              </div>
            </fieldset>
          </section>

          <section>
            <div className="mb-2 flex items-baseline justify-between gap-4">
              <h3 className="text-[13px] font-semibold">{t("editor.lines")}</h3>
              <span className="tnum text-[12px] text-faint" data-testid="v5-line-count">{t("editor.lineCount", { count: rows.length, max: MAX_INVOICE_ITEMS })}</span>
            </div>
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
                const previewLine = special ? displayLines.find((line) => line.billingItemId === row.billingItemId) : undefined;
                const problem = rowError(row);
                return (
                  <div key={row.key} className="grid grid-cols-[minmax(0,1fr)_2rem] gap-x-2 gap-y-2 border-b border-line py-3 sm:grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_6.5rem_7rem_2rem] sm:items-start" data-testid="v5-editor-row">
                    <div className="min-w-0">
                      {row.billingItemId ? (
                        <Input value={special ? previewLine?.description ?? row.description : row.description} onChange={(event) => update(row.key, { description: event.target.value })} disabled={special} aria-label={t("editor.description")} data-testid={`v5-row-description-${index}`} />
                      ) : (
                        <Combobox
                          value={row.description}
                          onInput={(text) => update(row.key, { description: text })}
                          options={productOptions}
                          onPick={(id) => pickProduct(row.key, id)}
                          placeholder={t("editor.searchProduct")}
                          ariaLabel={t("editor.description")}
                          testId={`v5-row-description-${index}`}
                          disabled={special}
                        />
                      )}
                      <span className="mt-1 block text-[12px] text-faint">
                        <span className="tnum">#{index + 1} · </span>
                        {item ? t("editor.fromBilling", { project: project?.name ?? "", left: moneyExact(leftFor.get(item.id) ?? 0) }) : row.productId ? products.find((p) => p.id === row.productId)?.productCode : t("detail.freeLine")}
                      </span>
                      {!row.billingItemId && (
                        <button type="button" disabled={rows.length >= MAX_INVOICE_ITEMS}
                          onClick={() => duplicateRow(row.key)}
                          className="mt-1 text-[12px] text-accent hover:underline disabled:opacity-40"
                          data-testid={`v5-row-duplicate-${index}`}>{t("editor.duplicateLine")}</button>
                      )}
                      {problem && <span className="mt-0.5 block text-[12px] text-danger" data-testid={`v5-row-error-${index}`}>{problem}</span>}
                    </div>
                    <button type="button" disabled={removalLocked} onClick={() => setRows((current) => current.filter((entry) => entry.key !== row.key))} aria-label={t("editor.removeLine")} className="h-11 text-[18px] text-faint hover:text-danger disabled:cursor-not-allowed disabled:opacity-40 sm:order-last" data-testid={`v5-row-remove-${index}`}>×</button>
                    <div className="col-span-2 grid grid-cols-4 gap-2 sm:contents">
                      <Input inputMode="decimal" value={special ? String(previewLine?.quantity ?? 1) : row.quantity} onChange={(event) => update(row.key, { quantity: event.target.value })} aria-label={t("editor.qty")} className="tnum text-right" disabled={special} data-testid={`v5-row-qty-${index}`} />
                      <Input value={special ? previewLine?.unit ?? "" : row.unit} onChange={(event) => update(row.key, { unit: event.target.value })} aria-label={t("editor.unit")} disabled={special} data-testid={`v5-row-unit-${index}`} />
                      <Input inputMode="decimal" value={special ? String(previewLine?.unitPrice ?? 0) : row.unitPrice} onChange={(event) => update(row.key, { unitPrice: event.target.value })} aria-label={t("editor.unitPrice")} className="tnum text-right" disabled={special || !!row.billingItemId} data-testid={`v5-row-price-${index}`} />
                      {row.billingItemId ? (
                        <Input inputMode="decimal" value={special ? String(previewLine?.amount ?? 0) : row.amount} onChange={(event) => update(row.key, { amount: event.target.value })} aria-label={t("editor.amount")} className="tnum text-right font-medium" disabled={special} data-testid={`v5-row-amount-${index}`} />
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
            {isDepositKind(invoiceKind) && !contractId && !editing && (
              <label className="mt-3 block max-w-xl">
                <span className="mb-1 block text-[12px] font-medium text-muted">{t("editor.addLinkedLine")}</span>
                <Select value={billingChoice} onChange={(event) => event.target.value && addLinkedBillingLine(event.target.value)} data-testid="v5-add-linked-line">
                  <option value="">{t("editor.selectBillingLine")}</option>
                  {depositBillingOptions.filter((option) => !rows.some((row) => row.billingItemId === option.id)).map((option) => (
                    <option key={option.id} value={option.id}>{option.label}{option.hint ? ` · ${option.hint}` : ""}</option>
                  ))}
                </Select>
              </label>
            )}
            {!special && <button
              type="button"
              onClick={() => addBlankRows(1)}
              disabled={rows.length >= MAX_INVOICE_ITEMS}
              className="mt-3 inline-flex h-9 items-center gap-1.5 text-[13.5px] font-medium text-accent hover:underline disabled:opacity-40"
              data-testid="v5-add-line"
            >
              <span aria-hidden className="text-[17px] leading-none">+</span>
              {t("editor.addLine")}
            </button>}
            {!special && <button
              type="button"
              disabled={rows.length >= MAX_INVOICE_ITEMS}
              onClick={() => addBlankRows(5)}
              className="ml-5 inline-flex h-9 items-center gap-1.5 text-[13.5px] font-medium text-accent hover:underline disabled:opacity-40"
              data-testid="v5-add-five-lines"
            >
              <span aria-hidden className="text-[17px] leading-none">+</span>
              {t("editor.addFiveLines")}
            </button>}
            {special && <p className="mt-2 text-[12px] text-faint">{t("editor.contractLinesLocked")}</p>}
            {rows.length >= 20 && <p className="mt-1 text-[12px] text-faint">{t("editor.smallPrint")}</p>}
          </section>

          <section className="grid gap-6 border-t border-line pt-5 sm:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="grid content-start gap-3 sm:grid-cols-2">
              {special ? (
                <>
                  {isDepositKind(invoiceKind) && (
                    <label className="block sm:col-span-2">
                      <span className="mb-1 block text-[12px] font-medium text-muted">
                        {t(invoiceKind === "DEPOSIT_FIXED" ? "editor.depositFixedValue" : "editor.depositPercentValue")}
                      </span>
                      <Input inputMode="decimal" value={depositValue} onChange={(event) => setDepositValue(event.target.value)} className="tnum text-right" data-testid="v5-deposit-value" />
                      <span className="mt-1 block text-[12px] text-faint">{t("editor.depositValueHint")}</span>
                    </label>
                  )}
                  <p className="text-[12.5px] text-muted sm:col-span-2">{t("editor.depositModeHint")}</p>
                  <p className="rounded-lg bg-fill px-3 py-2 text-[12px] text-pending sm:col-span-2">{t("editor.depositTaxNote")}</p>
                </>
              ) : (
                <>
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
                </>
              )}
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
        message={t("prepare.confirmBody", { number: selectedNumber, total: moneyExact(totals.totalUsd) })}
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

