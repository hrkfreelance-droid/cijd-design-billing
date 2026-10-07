'use client';
import {useEffect,useState} from 'react';
import {api,useData} from '@/components/providers';
import {Button} from '@/components/ui';
import {InvoiceEditor} from '@/components/billing-v5/invoice-editor';
import {InvoiceList} from '@/components/billing-v5/invoice-list';
import {BoardSkeleton} from '@/components/billing-v3/v3-shell';
import type {InvoiceDraft} from '@/lib/billing-v5/tax-history';

export default function DirectInvoices(){
 const {snapshot}=useData();
 const [editing,setEditing]=useState<InvoiceDraft|'new'|null>(null);
 const [drafts,setDrafts]=useState<InvoiceDraft[]>([]);
 useEffect(()=>{let live=true;api<InvoiceDraft[]>('/api/v5/invoice-drafts').then(rows=>{if(live)setDrafts(rows);}).catch(()=>{});return()=>{live=false;};},[snapshot,editing]);
 if(!snapshot)return <BoardSkeleton/>;
 return <div className="px-5 py-6 pb-32 sm:px-8" data-testid="v5-direct-invoices">
  <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-[26px] font-semibold">Invoice</h1><p className="mt-1 text-[13px] text-muted">Create a normal invoice directly, without a Design project.</p></div><Button variant="primary" onClick={()=>setEditing('new')} data-testid="v5-direct-invoice-new">+ New Invoice</Button></header>
  <section className="mt-8" data-testid="v5-direct-drafts"><h2 className="text-[15px] font-semibold">Drafts</h2>{drafts.filter(d=>d.status==='DRAFT'&&d.input.invoiceType==='INVOICE').map(d=><button className="block w-full border-b border-line py-3 text-left text-[13px]" key={d.id} onClick={()=>setEditing(d)}>Draft · {String((d.input.customer as {companyNameEn?:string})?.companyNameEn||'Customer UNKNOWN')} · {String(d.input.invoiceDate||'Date UNKNOWN')} · No number reserved</button>)}</section>
  <InvoiceList snapshot={snapshot} invoiceType="INVOICE"/>
  {editing&&<InvoiceEditor mode="create" snapshot={snapshot} customerId={null} billingItemIds={[]} invoiceType="INVOICE" draft={editing==='new'?undefined:editing} onClose={()=>setEditing(null)}/>}
 </div>;
}
