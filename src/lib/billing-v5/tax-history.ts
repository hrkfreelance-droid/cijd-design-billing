import { RuleError } from '../data/repository';
import type { Customer, Database, TaxInvoiceRecord } from '../types';
import { nextCode } from './calculation';
import { nextInvoiceNumber } from './invoicing';

export type HistoricalCustomer = Pick<Customer, 'companyNameEn'|'companyNameKm'|'addressEn'|'addressKm'|'telephone'|'vatin'>;
export interface SourceInvoice {
  id: string; sourceSha256: string; sourceFile: string; sheet: string; sheetId: string;
  displayedNumber: string; invoiceDate: string|null; dateRaw: string; customer: HistoricalCustomer;
  exchangeRate: number|null; items: {description:string;quantity:number;unitPrice:number;amount:number;sourceRow:number}[];
  totals: {subtotalUsd:number|null;vatUsd:number|null;totalUsd:number|null;totalKhr:number|null};
  discountUsd: number|null; taxableUsd: number|null; cancelled:boolean; issues:string[]; raw:Record<string,unknown>;
}
export interface HistoryEntry extends SourceInvoice {
  importedAt:string; customerId:string|null; invoiceId:string|null;
  importStatus:'Imported'|'Imported with warning'|'Conflict'|'Needs review'|'Cancelled';
}
export interface NumberReservation {invoiceNumber:string;ownerId:string;sourceId:string;reason:string}
export interface InvoiceDraft {id:string;status:'DRAFT'|'ISSUED'|'CANCELLED';input:Record<string,unknown>;createdAt:string;updatedAt:string;actor:string;revision:number;issuedInvoiceId:string|null}
export interface WorkbookImport {version:number;sourceSha256:string;sourceFile:string;sheets:SourceInvoice[];summary:Record<string,unknown>}
export const normalizeIdentity=(value:string)=>value.normalize('NFKC').replace(/[\u200b-\u200f\ufeff]/g,'').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu,'');
export const validNumber=(value:string)=>/^CIJDTI\d{4}\d{3,}$/.test(value);

function customerForSource(db:Database, row:SourceInvoice, at:string): {id:string|null;issues:string[]} {
  const fields=row.customer; const issues:string[]=[];
  if (!fields.companyNameEn.trim() && !fields.companyNameKm.trim())return {id:null,issues:['UNKNOWN_CUSTOMER']};
  const vat=normalizeIdentity(fields.vatin);const name=normalizeIdentity(fields.companyNameEn||fields.companyNameKm);
  let matches=(db.customers??[]).filter(c=>vat && normalizeIdentity(c.vatin)===vat);
  if (!matches.length) matches=(db.customers??[]).filter(c=>normalizeIdentity(c.companyNameEn||c.companyNameKm)===name && (!vat||!c.vatin||normalizeIdentity(c.vatin)===vat));
  // Different tax IDs always remain separate, even when legal names are identical.
  if(matches.length>1)return {id:null,issues:['AMBIGUOUS_CUSTOMER_MATCH']};
  if(matches.length===1){
    const existing=matches[0];
    for(const key of Object.keys(fields) as (keyof HistoricalCustomer)[]){
      if(fields[key] && normalizeIdentity(fields[key])!==normalizeIdentity(existing[key]))issues.push(`CUSTOMER_MASTER_DIFF:${key}`);
    }
    // Existing fields, including blanks, are preserved. Source details stay in history.
    return {id:existing.id,issues};
  }
  const candidates=(db.customers??[]).filter(c=>{
    const old=normalizeIdentity(c.companyNameEn);
    return old.length>=5 && name.includes(old);
  });
  for(const c of candidates)issues.push(`POSSIBLE_EXISTING_CUSTOMER_REVIEW:${c.companyNameEn}`);
  const id=`tax-customer:${vat||name}`;
  if(db.clients.some(c=>c.id===id))return {id:null,issues:['CUSTOMER_ID_CONFLICT']};
  const legalName=fields.companyNameEn||fields.companyNameKm;
  if((db.customers??[]).some(c=>normalizeIdentity(c.companyNameEn)===name))issues.push('SAME_NAME_DIFFERENT_VATIN');
  db.clients.push({id,name:legalName,active:true,createdAt:at});
  db.customers??=[];
  db.customers.push({id,customerCode:nextCode('C',db.customers.map(c=>c.customerCode)),...fields,contactPerson:'',email:'',active:true,createdAt:at,updatedAt:at,updatedBy:'tax-excel-import'});
  return {id,issues};
}

/** Additive, deterministic, preserves every source sheet and every existing record. */
export function importTaxHistory(db:Database, book:WorkbookImport, at=new Date().toISOString()) {
  if(book.version!==1 || !/^[a-f0-9]{64}$/.test(book.sourceSha256)||!Array.isArray(book.sheets)||!book.sheets.length)throw new RuleError('INVALID_IMPORT','Invalid workbook staging data.',400);
  db.taxImportHistory??=[];db.invoiceNumberReservations??=[];db.taxInvoices??=[];db.customers??=[];db.invoiceRevisions??=[];
  const counts={sheets:book.sheets.length,staged:0,skipped:0,customersAdded:0,invoicesAdded:0,cancelled:0,conflicts:0,needsReview:0};
  const seen=new Set<string>();const duplicate=new Map<string,number>();
  for(const row of book.sheets){
    if(row.sourceSha256!==book.sourceSha256 || row.id!==`${book.sourceSha256}:${row.sheetId}` || seen.has(row.id))throw new RuleError('INVALID_IMPORT','Invalid or duplicate source identity.',400);
    seen.add(row.id);if(row.displayedNumber)duplicate.set(row.displayedNumber,(duplicate.get(row.displayedNumber)??0)+1);
  }
  for(const source of book.sheets){
    if(db.taxImportHistory.some(r=>r.id===source.id)){counts.skipped++;continue;}
    const row=structuredClone(source);counts.staged++;if(row.cancelled)counts.cancelled++;
    const before=db.customers.length;const customer=customerForSource(db,row,at);counts.customersAdded+=db.customers.length-before;
    row.issues=[...new Set([...row.issues,...customer.issues])];
    const conflict=(duplicate.get(row.displayedNumber)??0)>1 || db.taxInvoices.some(r=>r.invoiceNumber===row.displayedNumber) || db.invoices.some(r=>r.invoiceNumber===row.displayedNumber);
    if(conflict)row.issues.push('INVOICE_NUMBER_CONFLICT');
    const datesValid=typeof row.invoiceDate==='string' && /^\d{4}-\d{2}-\d{2}$/.test(row.invoiceDate) && !Number.isNaN(Date.parse(row.invoiceDate)) && new Date(row.invoiceDate).toISOString().slice(0,10)===row.invoiceDate;
    const values=Object.values(row.totals);
    const lineValid=row.items.length>0 && row.items.every(i=>i.description.trim() && Number.isFinite(i.quantity)&&i.quantity>0&&Number.isFinite(i.unitPrice)&&i.unitPrice>=0&&Number.isFinite(i.amount)&&i.amount>=0 && Math.abs(i.quantity*i.unitPrice-i.amount)<.011);
    const totalsValid=values.every(v=>v!==null&&Number.isFinite(v)&&v>=0) && Math.abs(row.items.reduce((a,i)=>a+i.amount,0)-row.totals.subtotalUsd!)<.011 && Math.abs((row.taxableUsd??row.totals.subtotalUsd!)*.1-row.totals.vatUsd!)<.011 && Math.abs((row.taxableUsd??row.totals.subtotalUsd!)+row.totals.vatUsd!-row.totals.totalUsd!)<.011 && typeof row.exchangeRate==='number' && row.exchangeRate>0 && Math.abs(row.totals.totalUsd!*row.exchangeRate-row.totals.totalKhr!)<=.51;
    const blockers=row.issues.some(i=>/^(MALFORMED_DISPLAYED_NUMBER|SHEET_DISPLAY_MISMATCH|DUPLICATE_DISPLAYED_NUMBER|UNSAFE_|.*MISMATCH|UNKNOWN_DATE|UNKNOWN_EXCHANGE_RATE|NO_SAFE_ITEMS|UNKNOWN_TOTALS|UNKNOWN_TOTAL_LAYOUT|UNKNOWN_CUSTOMER|AMBIGUOUS_CUSTOMER_MATCH)/.test(i));
    const safe=!conflict&&!blockers&&datesValid&&lineValid&&totalsValid&&validNumber(row.displayedNumber)&&customer.id;
    let invoiceId:string|null=null;
    if(safe){
      invoiceId=`tax-excel:${row.id}`;
      const invoice:TaxInvoiceRecord={id:invoiceId,projectId:'',projectIds:[],clientId:customer.id!,ledgerInvoiceId:'',invoiceNumber:row.displayedNumber,invoiceDate:row.invoiceDate!,status:row.cancelled?'CANCELLED':'ISSUED',customer:row.customer,project:{name:'',note:'Imported historical invoice; collection status is UNKNOWN.'},lines:row.items.map(i=>({billingItemId:null,...i})),vatApplicable:true,vatPercent:10,subtotalUsd:row.totals.subtotalUsd!,vatUsd:row.totals.vatUsd!,totalUsd:row.totals.totalUsd!,totalKhr:row.totals.totalKhr!,discount:row.discountUsd?{type:'FIXED',value:row.discountUsd}:null,discountUsd:row.discountUsd??0,taxableUsd:row.taxableUsd??row.totals.subtotalUsd!,exchangeRate:row.exchangeRate!,exchangeRateSource:'MANUAL',exchangeRateEffectiveDate:null,issuedAt:at,issuedBy:'tax-excel-import',cancelledAt:null,cancelledBy:null,cancellationReason:row.cancelled?'Cancelled in source workbook; cancellation date UNKNOWN':null,revision:1,note:`Source: ${row.sourceFile} / ${row.sheet}; original issue timestamp UNKNOWN.`,historicalSourceId:row.id};
      db.taxInvoices.push(invoice);db.invoiceRevisions.push({id:`rev:${invoiceId}:import`,invoiceId,revision:1,action:'ISSUE',changedAt:at,changedBy:'tax-excel-import',reason:'Historical migration; original issue timestamp UNKNOWN',previousSnapshot:null});counts.invoicesAdded++;
    }
    let importStatus:HistoryEntry['importStatus']=conflict?'Conflict':!safe?'Needs review':row.issues.length?'Imported with warning':'Imported';
    if(row.cancelled && !conflict)importStatus='Cancelled';
    if(conflict)counts.conflicts++;else if(!safe)counts.needsReview++;
    db.taxImportHistory.push({...row,importedAt:at,customerId:customer.id,invoiceId,importStatus});
    // Consume both the displayed valid number and a canonical sheet number on mismatch.
    // Malformed identifiers remain verbatim in history; no guessed replacement invoice.
    for(const n of [row.displayedNumber,row.sheet.replace(/[\u200b-\u200f\ufeff]/g,'').trim()]){
      if(!validNumber(n)||db.invoiceNumberReservations.some(r=>r.invoiceNumber===n))continue;
      const existing=db.taxInvoices.find(i=>i.invoiceNumber===n);
      db.invoiceNumberReservations.push({invoiceNumber:n,ownerId:existing?.id??`historical-reserved:${n}`,sourceId:row.id,reason:row.cancelled?'Source cancelled invoice':safe?'Historical invoice':'Source conflict/review; number consumed'});
    }
  }
  if(counts.staged)db.auditLogs.push({id:`tax-import:${book.sourceSha256}`,at,actor:'tax-excel-import',action:'tax.history.import',entity:'workbook',entityId:book.sourceSha256,detail:JSON.stringify(counts)});
  return {...counts,highestStoredNumber:highestNumber(db,2026),nextAvailableNumber:nextInvoiceNumber(db,2026,false)};
}
export function highestNumber(db:Database,year:number){
 const n=[...(db.taxInvoices??[]).map(r=>r.invoiceNumber),...db.invoices.map(r=>r.invoiceNumber??""),...(db.invoiceNumberReservations??[]).map(r=>r.invoiceNumber)].filter(validNumber).filter(n=>n.startsWith(`CIJDTI${year}`)).sort((a,b)=>Number(a.slice(10))-Number(b.slice(10)));
 return n.at(-1)??null;
}
