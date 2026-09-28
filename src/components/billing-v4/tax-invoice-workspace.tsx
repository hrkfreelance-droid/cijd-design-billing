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
  const [busy, setBusy] = useState(false);
  const reload = async () => { try { const [cs, is] = await Promise.all([api<V4Customer[]>("/api/v4/customers"), api<V4Invoice[]>("/api/v4/tax-invoices")]); setCustomers(cs); setInvoices(is); } catch (error) { toast(error instanceof Error ? error.message : "V4 persistence is unavailable", "error"); } };
  useEffect(() => { void reload(); }, []);
  const totals = useMemo(() => calculateTaxInvoice(lines, rate || null), [lines, rate]);
  const updateLine = (id: string, patch: Partial<TaxInvoiceLineDraft>) => setLines((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  const saveDraft = async () => { setBusy(true); try { const result = await api<V4Invoice>(draftId ? `/api/v4/tax-invoices/${draftId}` : "/api/v4/tax-invoices", { method: draftId ? "PATCH" : "POST", body: { customerId, invoiceDate: date, exchangeRate: rate || null, lines } }); setDraftId(result.id); toast("Draft saved"); await reload(); } catch (error) { toast(error instanceof Error ? error.message : "Could not save Draft", "error"); } finally { setBusy(false); } };
  const issue = async () => { if (!draftId) { await saveDraft(); return; } setBusy(true); try { await api(`/api/v4/tax-invoices/${draftId}/issue`, { method: "POST" }); toast("Invoice issued"); setDraftId(null); setLines([blankLine()]); await reload(); } catch (error) { toast(error instanceof Error ? error.message : "Could not issue invoice", "error"); } finally { setBusy(false); } };
  const createCustomer = async () => { if (!newCustomer.name.trim()) return; const created = await api<V4Customer>("/api/v4/customers", { method: "POST", body: newCustomer }); setCustomers((current) => [...current, created]); setCustomerId(created.id); setNewCustomer({ name: "", khmerName: "", address: "", phone: "", vatin: "" }); };
  return <section className="mt-8 rounded-2xl border border-line bg-panel p-5" data-testid="v4-tax-workspace">
    <div className="flex flex-wrap items-baseline justify-between gap-3"><h2 className="font-semibold">V4 Tax Invoice</h2><span className="text-sm text-muted">Drafts are saved in the V4 ledger</span></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-3"><label className="text-sm">Customer<select value={customerId} onChange={(event) => setCustomerId(event.target.value)} className="mt-1 block w-full rounded-xl border border-line bg-bg px-3 py-2"><option value="">Select customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label><label className="text-sm">Invoice date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 block w-full rounded-xl border border-line bg-bg px-3 py-2" /></label><label className="text-sm">Exchange rate<input value={rate} onChange={(event) => setRate(event.target.value)} placeholder="NBC or manual" className="mt-1 block w-full rounded-xl border border-line bg-bg px-3 py-2" />{snapshot?.exchangeRate && <span className="text-xs text-muted">NBC {formatRate(snapshot.exchangeRate.rate)} · {snapshot.exchangeRate.effectiveDate}</span>}</label></div>
    <details className="mt-4 rounded-xl border border-line p-3"><summary className="cursor-pointer text-sm font-medium">Create customer</summary><div className="mt-3 grid gap-2 sm:grid-cols-5">{(["name", "khmerName", "address", "phone", "vatin"] as const).map((field) => <input key={field} value={newCustomer[field]} onChange={(event) => setNewCustomer({ ...newCustomer, [field]: event.target.value })} placeholder={field} className="rounded-lg border border-line bg-bg px-2 py-2 text-sm" />)}</div><button type="button" onClick={() => void createCustomer()} className="mt-3 rounded-full border border-line px-3 py-1.5 text-sm">Create customer</button></details>
    <div className="mt-5 space-y-2">{lines.map((item) => <div key={item.id} className="grid gap-2 sm:grid-cols-[1fr_90px_110px_110px_auto]"> <input value={item.description} onChange={(event) => updateLine(item.id, { description: event.target.value })} placeholder={item.sourceType === "MANUAL" ? "Manual description" : "Billing item"} className="rounded-lg border border-line bg-bg px-3 py-2 text-sm" /><input value={item.quantity} onChange={(event) => updateLine(item.id, { quantity: event.target.value })} aria-label="Quantity" className="rounded-lg border border-line bg-bg px-3 py-2 text-sm" /><input value={item.unitPrice} onChange={(event) => updateLine(item.id, { unitPrice: event.target.value })} aria-label="Unit price" className="rounded-lg border border-line bg-bg px-3 py-2 text-sm" /><output className="rounded-lg bg-fill px-3 py-2 text-sm">{calculateTaxInvoice([item]).subtotal}</output><button type="button" onClick={() => setLines((current) => current.filter((line) => line.id !== item.id))} className="rounded-lg px-2 text-muted hover:text-text">×</button></div>)}</div>
    <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => setLines((current) => [...current, blankLine("MANUAL")])} className="rounded-full border border-line px-3 py-1.5 text-sm">+ Manual Item</button><button type="button" onClick={() => setLines((current) => [...current, blankLine("BILLING_ITEM")])} className="rounded-full border border-line px-3 py-1.5 text-sm">+ Billing Item</button></div>
    <div className="mt-5 flex flex-wrap items-end justify-between gap-4"><div className="text-sm text-muted">Subtotal {totals.subtotal} · VAT {totals.vatAmount}<div className="text-lg font-semibold text-text">USD {totals.usdTotal}</div>{rate && <div>KHR {formatKhr(Number(totals.usdTotal), Number(rate))}</div>}</div><div className="flex gap-2"><button type="button" disabled={busy || !customerId} onClick={() => void saveDraft()} className="rounded-full border border-line px-4 py-2 text-sm disabled:opacity-40">Save Draft</button><button type="button" disabled={busy || !customerId || !lines.length} onClick={() => void issue()} className="rounded-full bg-text px-4 py-2 text-sm font-medium text-bg disabled:opacity-40">Issue</button></div></div>
    <div className="mt-6 border-t border-line pt-4"><h3 className="text-sm font-semibold">V4 History</h3><div className="mt-2 space-y-1 text-sm">{invoices.map((invoice) => <div key={invoice.id} className="flex flex-wrap justify-between gap-3 rounded-lg px-2 py-2 hover:bg-fill"><span>{invoice.invoiceNumber ?? "Draft"} · {invoice.customerName}</span><span className="text-muted">{invoice.status} · {invoice.usdTotal} USD</span></div>)}</div></div>
  </section>;
}
