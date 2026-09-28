"use client";

import { useEffect, useMemo, useState } from "react";
import { api, useData, useToast } from "@/components/providers";
import { calculateTaxInvoice, type TaxInvoiceLineDraft } from "@/lib/tax-invoice-v4";
import type { V4Customer, V4Invoice } from "@/lib/v4/types";
import { formatKhr, formatRate } from "@/lib/exchange-rate";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Phnom_Penh" }).format(new Date());
const blankLine = (sourceType: "MANUAL" | "BILLING_ITEM" = "MANUAL"): TaxInvoiceLineDraft => ({ id: crypto.randomUUID(), sourceType, billingItemId: null, description: "", quantity: "1", unitPrice: "0", sortOrder: 0 });

export function TaxInvoiceWorkspace() {
  const { snapshot } = useData();
  const { toast } = useToast();
  const [customers, setCustomers] = useState<V4Customer[]>([]);
  const [invoices, setInvoices] = useState<V4Invoice[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [lines, setLines] = useState<TaxInvoiceLineDraft[]>([blankLine()]);
  const [date, setDate] = useState(today());
  const [rate, setRate] = useState("");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [newCustomer, setNewCustomer] = useState({ name: "", khmerName: "", address: "", phone: "", vatin: "" });
  const [editCustomer, setEditCustomer] = useState<V4Customer | null>(null);
  const [printInvoice, setPrintInvoice] = useState<V4Invoice | null>(null);
  const [busy, setBusy] = useState(false);
  const billingItems = snapshot?.billingItems ?? [];

  const reload = async () => {
    try {
      const [cs, is] = await Promise.all([api<V4Customer[]>("/api/v4/customers"), api<V4Invoice[]>("/api/v4/tax-invoices")]);
      setCustomers(cs);
      setInvoices(is);
    } catch (error) {
      toast(error instanceof Error ? error.message : "V4 persistence is unavailable", "error");
    }
  };

  useEffect(() => { void reload(); }, []);
  useEffect(() => {
    if (!rate && snapshot?.exchangeRate) setRate(String(snapshot.exchangeRate.rate));
  }, [rate, snapshot?.exchangeRate]);

  const totals = useMemo(() => calculateTaxInvoice(lines, rate || null), [lines, rate]);
  const updateLine = (id: string, patch: Partial<TaxInvoiceLineDraft>) => setLines((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  const validateLines = () => {
    if (lines.some((item) => item.sourceType === "BILLING_ITEM" && !item.billingItemId)) {
      toast("Select a Billing Item for every Billing Item line", "error");
      return false;
    }
    return true;
  };
  const persistDraft = async () => {
    if (!validateLines()) throw new Error("Billing Item is required");
    return api<V4Invoice>(draftId ? `/api/v4/tax-invoices/${draftId}` : "/api/v4/tax-invoices", {
      method: draftId ? "PATCH" : "POST",
      body: { customerId, invoiceDate: date, exchangeRate: rate || null, exchangeRateSource: rate === String(snapshot?.exchangeRate?.rate) ? "NBC" : "MANUAL", exchangeRateDate: snapshot?.exchangeRate?.effectiveDate ?? null, lines },
    });
  };
  const saveDraft = async () => {
    setBusy(true);
    try {
      const result = await persistDraft();
      setDraftId(result.id);
      toast("Draft saved");
      await reload();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save Draft", "error");
    } finally { setBusy(false); }
  };
  const issue = async () => {
    setBusy(true);
    try {
      const draft = draftId ? null : await persistDraft();
      const id = draftId ?? draft?.id;
      if (!id) throw new Error("Draft could not be created");
      await api(`/api/v4/tax-invoices/${id}/issue`, { method: "POST" });
      toast("Invoice issued");
      setDraftId(null);
      setCustomerId("");
      setLines([blankLine()]);
      await reload();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not issue invoice", "error");
    } finally { setBusy(false); }
  };
  const createCustomer = async () => {
    if (!newCustomer.name.trim()) return;
    try {
      const created = await api<V4Customer>("/api/v4/customers", { method: "POST", body: newCustomer });
      setCustomers((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
      setCustomerId(created.id);
      setEditCustomer(created);
      setNewCustomer({ name: "", khmerName: "", address: "", phone: "", vatin: "" });
      toast("Customer created");
    } catch (error) { toast(error instanceof Error ? error.message : "Could not create customer", "error"); }
  };
  const updateCustomer = async () => {
    if (!editCustomer) return;
    try {
      const updated = await api<V4Customer>(`/api/v4/customers/${editCustomer.id}`, { method: "PATCH", body: editCustomer });
      setCustomers((current) => current.map((customer) => customer.id === updated.id ? updated : customer).sort((a, b) => a.name.localeCompare(b.name)));
      setEditCustomer(updated);
      toast("Customer updated");
    } catch (error) { toast(error instanceof Error ? error.message : "Could not update customer", "error"); }
  };
  const editDraft = async (id: string) => {
    setBusy(true);
    try {
      const invoice = await api<V4Invoice>(`/api/v4/tax-invoices/${id}`);
      setDraftId(invoice.id);
      setCustomerId(invoice.customerId ?? "");
      setDate(invoice.invoiceDate);
      setRate(invoice.exchangeRate ?? "");
      setLines(invoice.lines.length ? invoice.lines : [blankLine()]);
      toast("Draft loaded");
    } catch (error) { toast(error instanceof Error ? error.message : "Could not load Draft", "error"); }
    finally { setBusy(false); }
  };
  const cancelInvoice = async (id: string) => {
    setBusy(true);
    try { await api(`/api/v4/tax-invoices/${id}/cancel`, { method: "POST" }); toast("Invoice cancelled"); await reload(); }
    catch (error) { toast(error instanceof Error ? error.message : "Could not cancel invoice", "error"); }
    finally { setBusy(false); }
  };
  const duplicateInvoice = async (id: string) => {
    setBusy(true);
    try {
      const duplicate = await api<V4Invoice>(`/api/v4/tax-invoices/${id}/duplicate`, { method: "POST" });
      setDraftId(duplicate.id);
      setCustomerId(duplicate.customerId ?? "");
      setDate(duplicate.invoiceDate);
      setRate(duplicate.exchangeRate ?? "");
      setLines(duplicate.lines.length ? duplicate.lines : [blankLine()]);
      toast("Duplicated as Draft");
      await reload();
    } catch (error) { toast(error instanceof Error ? error.message : "Could not duplicate invoice", "error"); }
    finally { setBusy(false); }
  };

  return <section className="mt-8 rounded-2xl border border-line bg-panel p-5" data-testid="v4-tax-workspace">
    <div className="flex flex-wrap items-baseline justify-between gap-3"><h2 className="font-semibold">V4 Tax Invoice</h2><span className="text-sm text-muted">Drafts are saved in the V4 ledger</span></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-3"><label className="text-sm">Customer<select value={customerId} onChange={(event) => { const id = event.target.value; setCustomerId(id); setEditCustomer(customers.find((customer) => customer.id === id) ?? null); }} className="mt-1 block w-full rounded-xl border border-line bg-bg px-3 py-2"><option value="">Select customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label><label className="text-sm">Invoice date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 block w-full rounded-xl border border-line bg-bg px-3 py-2" /></label><label className="text-sm">Exchange rate<input value={rate} onChange={(event) => setRate(event.target.value)} placeholder="NBC or manual" className="mt-1 block w-full rounded-xl border border-line bg-bg px-3 py-2" />{snapshot?.exchangeRate && <span className="text-xs text-muted">NBC {formatRate(snapshot.exchangeRate.rate)} · {snapshot.exchangeRate.effectiveDate}</span>}</label></div>
    <details className="mt-4 rounded-xl border border-line p-3"><summary className="cursor-pointer text-sm font-medium">Create customer</summary><div className="mt-3 grid gap-2 sm:grid-cols-5">{(["name", "khmerName", "address", "phone", "vatin"] as const).map((field) => <input key={field} value={newCustomer[field]} onChange={(event) => setNewCustomer({ ...newCustomer, [field]: event.target.value })} placeholder={field} className="rounded-lg border border-line bg-bg px-2 py-2 text-sm" />)}</div><button type="button" onClick={() => void createCustomer()} className="mt-3 rounded-full border border-line px-3 py-1.5 text-sm">Create customer</button></details>
    {editCustomer && <details className="mt-3 rounded-xl border border-line p-3"><summary className="cursor-pointer text-sm font-medium">Edit selected customer</summary><div className="mt-3 grid gap-2 sm:grid-cols-5">{(["name", "khmerName", "address", "phone", "vatin"] as const).map((field) => <input key={field} value={editCustomer[field] ?? ""} onChange={(event) => setEditCustomer({ ...editCustomer, [field]: event.target.value })} placeholder={field} className="rounded-lg border border-line bg-bg px-2 py-2 text-sm" />)}</div><button type="button" onClick={() => void updateCustomer()} className="mt-3 rounded-full border border-line px-3 py-1.5 text-sm">Save customer</button></details>}
    <div className="mt-5 space-y-2">{lines.map((item) => <div key={item.id} className="grid gap-2 sm:grid-cols-[minmax(220px,1fr)_90px_110px_110px_auto]">{item.sourceType === "BILLING_ITEM" ? <select aria-label="Billing item" value={item.billingItemId ?? ""} onChange={(event) => { const selected = billingItems.find((candidate) => candidate.id === event.target.value); updateLine(item.id, { billingItemId: event.target.value || null, description: selected?.description ?? "", quantity: selected ? String(selected.quantity) : "1", unitPrice: selected?.amount == null ? "0" : String(selected.amount) }); }} className="rounded-lg border border-line bg-bg px-3 py-2 text-sm"><option value="">Select Billing Item</option>{billingItems.filter((candidate) => candidate.amount != null).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.description} · ${candidate.amount?.toFixed(2)}</option>)}</select> : <input value={item.description} onChange={(event) => updateLine(item.id, { description: event.target.value })} placeholder="Manual description" className="rounded-lg border border-line bg-bg px-3 py-2 text-sm" />}<input value={item.quantity} onChange={(event) => updateLine(item.id, { quantity: event.target.value })} aria-label="Quantity" className="rounded-lg border border-line bg-bg px-3 py-2 text-sm" /><input value={item.unitPrice} onChange={(event) => updateLine(item.id, { unitPrice: event.target.value })} aria-label="Unit price" className="rounded-lg border border-line bg-bg px-3 py-2 text-sm" /><output className="rounded-lg bg-fill px-3 py-2 text-sm">{calculateTaxInvoice([item]).subtotal}</output><button type="button" onClick={() => setLines((current) => current.filter((line) => line.id !== item.id))} className="rounded-lg px-2 text-muted hover:text-text">×</button></div>)}</div>
    <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => setLines((current) => [...current, blankLine("MANUAL")])} className="rounded-full border border-line px-3 py-1.5 text-sm">+ Manual Item</button><button type="button" onClick={() => setLines((current) => [...current, blankLine("BILLING_ITEM")])} className="rounded-full border border-line px-3 py-1.5 text-sm">+ Billing Item</button></div>
    <div className="mt-5 flex flex-wrap items-end justify-between gap-4"><div className="text-sm text-muted">Subtotal {totals.subtotal} · VAT {totals.vatAmount}<div className="text-lg font-semibold text-text">USD {totals.usdTotal}</div>{rate && <div>KHR {formatKhr(Number(totals.usdTotal), Number(rate))}</div>}</div><div className="flex gap-2"><button type="button" disabled={busy || !customerId} onClick={() => void saveDraft()} className="rounded-full border border-line px-4 py-2 text-sm disabled:opacity-40">Save Draft</button><button type="button" disabled={busy || !customerId || !lines.length} onClick={() => void issue()} className="rounded-full bg-text px-4 py-2 text-sm font-medium text-bg disabled:opacity-40">Issue</button></div></div>
    <div className="mt-6 border-t border-line pt-4"><h3 className="text-sm font-semibold">V4 History</h3><div className="mt-2 space-y-1 text-sm">{invoices.map((invoice) => <div key={invoice.id} className="flex flex-wrap justify-between gap-3 rounded-lg px-2 py-2 hover:bg-fill"><span>{invoice.invoiceNumber ?? "Draft"} · {invoice.customerName}</span><span className="flex flex-wrap items-center gap-2 text-muted">{invoice.status} · {invoice.usdTotal} USD{invoice.status === "DRAFT" && <button type="button" onClick={() => void editDraft(invoice.id)} className="underline">Edit</button>}{invoice.status === "ISSUED" && <button type="button" disabled={busy} onClick={() => void cancelInvoice(invoice.id)} className="underline">Cancel</button>} {(invoice.status === "ISSUED" || invoice.status === "CANCELLED") && <button type="button" disabled={busy} onClick={() => void duplicateInvoice(invoice.id)} className="underline">Duplicate as Draft</button>}{invoice.status !== "DRAFT" && <><button type="button" onClick={() => setPrintInvoice(invoice)} className="underline">PDF / Print</button><button type="button" onClick={() => window.print()} className="underline">Print page</button></>}</span></div>)}</div></div>
    {printInvoice && <div role="dialog" aria-label="Tax Invoice print preview" data-testid="v4-print-preview" className="fixed inset-0 z-50 overflow-auto bg-bg/95 p-4 sm:p-8"><article className="mx-auto max-w-[794px] bg-white p-6 text-black shadow-2xl sm:p-10"><div className="flex justify-between border-b-2 border-black pb-4"><div><h2 className="text-xl font-bold">CIJD CO., LTD.</h2><p>ស៊ីអាយជេឌី ឯ.ក</p><h1 className="mt-3 text-3xl font-bold">TAX INVOICE</h1><p>វិក្កយបត្រអាករ</p></div><div className="text-right text-sm"><p><strong>No. {printInvoice.invoiceNumber ?? "Draft"}</strong></p><p>{printInvoice.invoiceDate}</p><p>{printInvoice.status}</p></div></div><div className="mt-5 text-sm"><p><strong>Customer / អតិថិជន:</strong> {printInvoice.customerName}</p><p>{printInvoice.customerKhmerName ?? ""}</p><p>{printInvoice.customerAddress ?? ""}</p><p>{printInvoice.customerPhone ?? ""}{printInvoice.customerVatin ? ` · VATIN ${printInvoice.customerVatin}` : ""}</p></div><table className="mt-7 w-full text-sm"><thead className="border-b border-black"><tr><th className="py-2 text-left">Description / បរិយាយ</th><th className="py-2 text-right">Quantity / បរិមាណ</th><th className="py-2 text-right">Unit Price / តម្លៃឯកតា (USD)</th><th className="py-2 text-right">Amount / ចំនួនទឹកប្រាក់ (USD)</th></tr></thead><tbody>{printInvoice.lines.map((line) => <tr key={line.id} className="border-b border-gray-300"><td className="py-2">{line.description}</td><td className="py-2 text-right">{line.quantity}</td><td className="py-2 text-right">{line.unitPrice}</td><td className="py-2 text-right">{line.amount ?? calculateTaxInvoice([line]).subtotal}</td></tr>)}</tbody></table><div className="ml-auto mt-6 w-64 text-sm"><div className="flex justify-between py-1"><span>Subtotal</span><span>${printInvoice.subtotal}</span></div><div className="flex justify-between py-1"><span>VAT 10%</span><span>${printInvoice.vatAmount}</span></div><div className="mt-1 flex justify-between border-t-2 border-black py-2 text-lg font-bold"><span>USD Total</span><span>${printInvoice.usdTotal}</span></div>{printInvoice.exchangeRate && printInvoice.khrTotal && <><div className="flex justify-between py-1"><span>Exchange Rate</span><span>{printInvoice.exchangeRate} KHR/USD</span></div><div className="flex justify-between py-1 font-bold"><span>KHR Total</span><span>៛{printInvoice.khrTotal}</span></div></>}</div><div className="mt-8 flex gap-2 print:hidden"><button type="button" onClick={() => window.print()} className="rounded-full bg-black px-4 py-2 text-sm text-white">Print / Save PDF</button><button type="button" onClick={() => setPrintInvoice(null)} className="rounded-full border border-gray-400 px-4 py-2 text-sm">Close</button></div></article></div>}
  </section>;
}
