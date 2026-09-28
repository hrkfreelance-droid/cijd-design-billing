"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { api, useData, useToast } from "@/components/providers";
import { formatKhr, formatRate } from "@/lib/exchange-rate";
import { moneyExact } from "@/lib/format";
import { BoardSkeleton } from "@/components/billing-v3/v3-shell";
import { openInvoicePdf } from "@/lib/invoice-pdf";
import { TaxInvoiceWorkspace } from "@/components/billing-v4/tax-invoice-workspace";

export default function TaxInvoicesPage() {
  const { snapshot } = useData();
  const { toast } = useToast();
  const [clientId, setClientId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  if (!snapshot) return <BoardSkeleton />;
  const clients = new Map(snapshot.clients.map((client) => [client.id, client.name]));
  const projects = new Map(snapshot.projects.map((project) => [project.id, project]));
  const available = snapshot.billingItems.filter((item) => projects.get(item.projectId)?.clientId === clientId).filter((item) => !item.invoiceId && item.amount != null && item.billingStatus === "READY_TO_INVOICE");
  const selectedItems = snapshot.billingItems.filter((item) => selected.includes(item.id));
  const subtotal = useMemo(() => selectedItems.reduce((sum, item) => sum + (item.amount ?? 0), 0), [selectedItems]);
  const vat = Math.round(subtotal * 0.1 * 100) / 100;
  const total = Math.round((subtotal + vat) * 100) / 100;
  const issue = async () => {
    if (!clientId || !selected.length) return;
    setBusy(true);
    try {
      await api("/api/invoices", { method: "POST", body: { clientId, billingItemIds: selected, invoiceNumber: invoiceNumber || undefined, invoiceDate } });
      toast("Tax Invoice issued");
      setSelected([]); setInvoiceNumber("");
      window.location.reload();
    } catch (error) { toast(error instanceof Error ? error.message : "Could not issue invoice", "error"); }
    finally { setBusy(false); }
  };
  const invoices = [...snapshot.invoices].sort((a, b) => (b.invoiceDate ?? b.createdAt).localeCompare(a.invoiceDate ?? a.createdAt));
  return <div className="px-5 pb-16 pt-6 sm:px-8 sm:pt-8">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Office V4</p><h1 className="mt-1 text-2xl font-semibold">Tax Invoices</h1><p className="mt-1 text-sm text-muted">Issued invoice history and frozen exchange-rate snapshots.</p></div>
      <Link href="/office-v4" className="rounded-full border border-line px-4 py-2 text-sm">Back to Billing</Link>
    </div>
    <section className="mt-8 rounded-2xl border border-line bg-panel p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3"><h2 className="font-semibold">Current USD / KHR rate</h2><span className="text-sm text-muted">NBC snapshot</span></div>
      {snapshot.exchangeRate ? <p className="mt-3 text-2xl font-semibold">{formatRate(snapshot.exchangeRate.rate)} <span className="text-sm font-normal text-muted">KHR / USD · effective {snapshot.exchangeRate.effectiveDate}</span></p> : <p className="mt-3 text-sm text-muted">No verified NBC rate is available. Enter a rate only after confirming the official source.</p>}
      {snapshot.exchangeRate && <p className="mt-1 text-xs text-muted">Example: $100 = {formatKhr(100, snapshot.exchangeRate.rate)}</p>}
    </section>
    <TaxInvoiceWorkspace />
    <section className="mt-8 rounded-2xl border border-line bg-panel p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3"><h2 className="font-semibold">New Tax Invoice</h2><span className="text-sm text-muted">Select ready-to-invoice items</span></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="text-sm">Customer<select value={clientId} onChange={(event) => { setClientId(event.target.value); setSelected([]); }} className="mt-1 block w-full rounded-xl border border-line bg-bg px-3 py-2"><option value="">Select customer</option>{snapshot.clients.filter((client) => client.active).map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
        <label className="text-sm">Invoice No. <span className="text-muted">(optional)</span><input value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} placeholder="Auto-number" className="mt-1 block w-full rounded-xl border border-line bg-bg px-3 py-2" /></label>
        <label className="text-sm">Date<input type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} className="mt-1 block w-full rounded-xl border border-line bg-bg px-3 py-2" /></label>
      </div>
      <div className="mt-5 overflow-x-auto rounded-xl border border-line"><table className="w-full min-w-[620px] text-left text-sm"><thead className="border-b border-line text-xs text-muted"><tr><th className="px-3 py-2">Pick</th><th className="px-3 py-2">Description</th><th className="px-3 py-2">Qty</th><th className="px-3 py-2">Unit price</th><th className="px-3 py-2">Amount</th></tr></thead><tbody>{available.map((item) => <tr key={item.id} className="border-b border-line last:border-0"><td className="px-3 py-2"><input type="checkbox" checked={selected.includes(item.id)} onChange={() => setSelected((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} /></td><td className="px-3 py-2">{item.description}</td><td className="px-3 py-2">{item.quantity}</td><td className="px-3 py-2">{moneyExact(item.unitPrice)}</td><td className="px-3 py-2">{moneyExact(item.amount ?? 0)}</td></tr>)}{!available.length && <tr><td colSpan={5} className="px-3 py-5 text-center text-muted">No ready items for this customer.</td></tr>}</tbody></table></div>
      <div className="mt-5 flex flex-wrap items-end justify-between gap-4"><div className="text-sm text-muted">Subtotal {moneyExact(subtotal)} · VAT 10% {moneyExact(vat)}<div className="mt-1 text-lg font-semibold text-text">USD Total {moneyExact(total)}</div>{snapshot.exchangeRate && <div className="text-xs">KHR Total {formatKhr(total, snapshot.exchangeRate.rate)} at {formatRate(snapshot.exchangeRate.rate)}</div>}</div><button type="button" disabled={busy || !clientId || !selected.length} onClick={() => void issue()} className="rounded-full bg-text px-5 py-2.5 text-sm font-medium text-bg disabled:cursor-not-allowed disabled:opacity-40">{busy ? "Issuing…" : "Preview & Issue"}</button></div>
    </section>
    <section className="mt-8"><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">History</h2><span className="text-sm text-muted">{invoices.length} records</span></div>
      <div className="overflow-x-auto rounded-2xl border border-line bg-panel"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b border-line text-xs text-muted"><tr><th className="px-4 py-3">Invoice No.</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">USD</th><th className="px-4 py-3">KHR rate</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Output</th></tr></thead><tbody>{invoices.map((invoice) => { const items = snapshot.invoiceItems.filter((link) => link.invoiceId === invoice.id).map((link) => snapshot.billingItems.find((item) => item.id === link.billingItemId)).filter((item): item is NonNullable<typeof item> => !!item); return <tr key={invoice.id} className="border-b border-line last:border-0"><td className="px-4 py-3 font-medium">{invoice.invoiceNumber ?? "—"}</td><td className="px-4 py-3">{clients.get(invoice.clientId) ?? "—"}</td><td className="px-4 py-3">{invoice.invoiceDate ?? "—"}</td><td className="px-4 py-3">{moneyExact(invoice.amount)}</td><td className="px-4 py-3">{invoice.exchangeRate ? `${formatRate(invoice.exchangeRate)} (${invoice.exchangeRateEffectiveDate ?? "date unknown"})` : "Unconfirmed"}</td><td className="px-4 py-3">{invoice.status}</td><td className="px-4 py-3"><button type="button" className="mr-3 text-sm underline" onClick={() => openInvoicePdf({ invoice, clientName: clients.get(invoice.clientId), items, projectNames: new Map(snapshot.projects.map((project) => [project.id, project.name])), locale: "en" })}>PDF</button><button type="button" className="text-sm underline" onClick={() => window.print()}>Print</button></td></tr>; })}</tbody></table></div>
    </section>
  </div>;
}
