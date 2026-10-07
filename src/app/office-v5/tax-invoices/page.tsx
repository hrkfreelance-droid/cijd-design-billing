'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {api,useData} from '@/components/providers';
import {Button,Input} from '@/components/ui';
import {InvoiceEditor} from '@/components/billing-v5/invoice-editor';
import {InvoiceList} from '@/components/billing-v5/invoice-list';
import {CustomerMaster} from '@/components/billing-v5/masters';
import {BoardSkeleton} from '@/components/billing-v3/v3-shell';
import type {HistoryEntry,InvoiceDraft} from '@/lib/billing-v5/tax-history';
export default function TaxWorkspace(){
 const {snapshot}=useData();const [view,setView]=useState<'invoices'|'customers'|'history'>('invoices');
 const [editing,setEditing]=useState<InvoiceDraft|'new'|null>(null);const [drafts,setDrafts]=useState<InvoiceDraft[]>([]);
 const [history,setHistory]=useState<HistoryEntry[]>([]);const [query,setQuery]=useState('');const [next,setNext]=useState('');const [error,setError]=useState('');
 useEffect(()=>{let live=true;Promise.all([api<InvoiceDraft[]>('/api/v5/invoice-drafts'),api<{history:HistoryEntry[];next:string}>('/api/v5/tax-history')]).then(([d,h])=>{if(live){setDrafts(d);setHistory(h.history);setNext(h.next);setError('');}}).catch(e=>{if(live)setError(e.message||'Could not load invoice history.');});return()=>{live=false;};},[snapshot,editing]);
 if(!snapshot)return <BoardSkeleton/>;
 const shown=history.filter(r=>!query||[r.sheet,r.displayedNumber,r.customer.companyNameEn,r.customer.vatin,r.importStatus,...r.issues].join(' ').toLowerCase().includes(query.toLowerCase()));
 return <div className="px-5 py-6 pb-32 sm:px-8" data-testid="v5-tax-workspace">
  <Link href="/office-v5/accounting" className="text-[13px] text-accent">← Accounting</Link>
  <header className="mt-4 flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-[26px] font-semibold">Tax Invoices</h1><p className="mt-1 text-[13px] text-muted">Next suggested number: <span className="tnum" data-testid="v5-next-number">{next||'UNKNOWN'}</span> · reserved at Issue</p></div><Button variant="primary" onClick={()=>setEditing('new')} data-testid="v5-tax-new">+ New Tax Invoice</Button></header>
  <nav className="mt-6 flex flex-wrap gap-5 border-b border-line pb-3">{(['invoices','customers','history'] as const).map(v=><button key={v} type="button" onClick={()=>setView(v)} className={view===v?'text-accent font-medium':'text-muted'} data-testid={`v5-tab-${v}`}>{v==='invoices'?'Invoices':v==='customers'?'Customer Master':'Import history'}</button>)}</nav>
  {error&&<p role="alert" className="mt-3 text-danger">{error}</p>}
  {view==='customers'&&<CustomerMaster snapshot={snapshot}/>}
  {view==='invoices'&&<><section className="mt-6" data-testid="v5-draft-list"><h2 className="text-[15px] font-semibold">Drafts</h2>{drafts.filter(d=>d.status==='DRAFT').map(d=><button className="block w-full border-b border-line py-3 text-left" key={d.id} onClick={()=>setEditing(d)} data-testid="v5-draft-row">Draft · {String((d.input.customer as {companyNameEn?:string})?.companyNameEn||'Customer UNKNOWN')} · {String(d.input.invoiceDate||'Date UNKNOWN')} · No number reserved</button>)}</section><InvoiceList snapshot={snapshot}/></>}
  {view==='history'&&<section className="mt-6" data-testid="v5-import-history"><p className="mb-4 text-[13px] text-muted">{history.length} source sheets · {history.filter(r=>r.invoiceId).length} converted invoices · {history.filter(r=>r.cancelled).length} cancelled source sheets · conflicts remain unchanged</p><Input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search number, VATIN, customer or warning" data-testid="v5-history-search"/>{shown.map(r=><details key={r.id} className="border-b border-line py-3" data-testid="v5-history-row"><summary className="cursor-pointer text-[13px]"><span className="font-medium">{r.sheet} → {r.displayedNumber||'UNKNOWN'}</span> · {r.importStatus}{r.cancelled?' · Cancelled':''} · {r.customer.companyNameEn||'UNKNOWN'}</summary><div className="mt-2 space-y-2 text-[12px] text-muted"><p>Date: {r.invoiceDate||'UNKNOWN'} · Rate: {r.exchangeRate??'UNKNOWN'} · VATIN: {r.customer.vatin||'UNKNOWN'}</p><p>{r.issues.join(' · ')||'No source warnings'}</p>{r.invoiceId&&<Link className="text-accent" href={`/office-v5/tax-invoices/${encodeURIComponent(r.invoiceId)}`}>Open historical invoice</Link>}<pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded bg-fill p-3">{JSON.stringify({customer:r.customer,items:r.items,totals:r.totals,raw:r.raw},null,2)}</pre></div></details>)}</section>}
  {editing&&<InvoiceEditor mode="create" snapshot={snapshot} customerId={null} billingItemIds={[]} draft={editing==='new'?undefined:editing} onClose={()=>setEditing(null)}/>}
 </div>;
}
