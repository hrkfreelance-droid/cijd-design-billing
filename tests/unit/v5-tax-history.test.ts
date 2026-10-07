import assert from 'node:assert/strict';
import {test} from 'node:test';
import {d1Persistence} from '../../src/lib/billing-v5/d1-persistence.ts';
import {buildV5Seed} from '../../src/lib/billing-v5/repository.ts';
import {importTaxHistory,type SourceInvoice,type WorkbookImport} from '../../src/lib/billing-v5/tax-history.ts';
import {issueInvoice,nextInvoiceNumber,saveCustomer,cancelInvoice} from '../../src/lib/billing-v5/invoicing.ts';
import {saveInvoiceDraft,issueSavedDraft} from '../../src/lib/billing-v5/drafts.ts';
import {sqliteD1} from './d1-sqlite.ts';
const SHA='a'.repeat(64);
const C={companyNameEn:'Example Co., Ltd.',companyNameKm:'',addressEn:'Phnom Penh',addressKm:'',telephone:'012',vatin:'VAT-123'};
function source(n=1,patch:Partial<SourceInvoice>={}):SourceInvoice{return {id:`${SHA}:${n}`,sourceSha256:SHA,sourceFile:'test.xlsx',sheet:`CIJDTI2026${String(n).padStart(3,'0')}`,sheetId:String(n),displayedNumber:`CIJDTI2026${String(n).padStart(3,'0')}`,invoiceDate:'2026-01-01',dateRaw:'01-January-2026',customer:{...C},exchangeRate:4000,items:[{description:'Design',quantity:2,unitPrice:10,amount:20,sourceRow:20}],totals:{subtotalUsd:20,vatUsd:2,totalUsd:22,totalKhr:88000},discountUsd:0,taxableUsd:null,cancelled:false,issues:[],raw:{drawings:[{text:'Company Name / Customer: Example Co., Ltd.'}]},...patch};}
const book=(sheets:SourceInvoice[]):WorkbookImport=>({version:1,sourceSha256:SHA,sourceFile:'test.xlsx',sheets,summary:{}});
const input=(id:string)=>({customerId:id,invoiceDate:'2026-10-07',customer:C,items:[{description:'Design',quantity:1,unitPrice:10}],exchangeRate:{rate:4100,source:'MANUAL' as const},actor:'QA',updateCustomerMaster:false});
test('every sheet staged, source/raw preserved; second import makes no customer, invoice or accounting duplicates',async()=>{
 const d1=sqliteD1();const p=d1Persistence(d1,buildV5Seed);const db=(await p.read())!;const b=book([source(),source(2)]);
 const first=importTaxHistory(db,b);assert.equal(first.customersAdded,1);assert.equal(first.invoicesAdded,2);await p.write(db);
 const next=(await p.read())!;const frozen=JSON.stringify(next);const second=importTaxHistory(next,b);assert.equal(second.skipped,2);assert.equal(second.invoicesAdded,0);assert.equal(JSON.stringify(next),frozen);assert.equal(next.invoices.length,0);assert.deepEqual(next.taxImportHistory![0].raw,b.sheets[0].raw);
});
test('exact VAT dedup, formatting normalization and existing values preserved; different VATs remain separate',()=>{
 const db=buildV5Seed();const c=saveCustomer(db,{name:'Existing',companyNameEn:C.companyNameEn,vatin:'VAT-123',addressEn:'Existing address',actor:'QA'});const frozen=JSON.stringify(c);
 const b=book([source(1,{customer:{...C,companyNameEn:'EXAMPLE CO LTD',vatin:'vat123'}}),source(2,{customer:{...C,vatin:'VAT-999'}})]);
 const result=importTaxHistory(db,b);assert.equal(result.customersAdded,1);assert.equal(JSON.stringify(c),frozen);assert.equal(db.taxImportHistory![0].customerId,c.id);assert.ok(db.taxImportHistory![0].issues.includes('CUSTOMER_MASTER_DIFF:addressEn'));
});
test('duplicate displayed numbers, cancelled source and malformed/mismatched numbers stay visible, consumed and uncorrected',()=>{
 const db=buildV5Seed();const b=book([source(1,{displayedNumber:'CIJDTI2026045',sheet:'CIJD2026044'}),source(2,{displayedNumber:'CIJDTI2026045',sheet:'CIJD2026045(cancelled)',cancelled:true}),source(3,{displayedNumber:'CIJDTI2026005.',sheet:'CIJDTI2026016',issues:['MALFORMED_DISPLAYED_NUMBER','SHEET_DISPLAY_MISMATCH']})]);
 const result=importTaxHistory(db,b);assert.equal(result.conflicts,2);assert.equal(result.invoicesAdded,0);assert.equal(db.taxImportHistory!.length,3);assert.equal(db.taxImportHistory![1].cancelled,true);assert.ok(db.invoiceNumberReservations!.some(r=>r.invoiceNumber==='CIJDTI2026045'));assert.ok(db.invoiceNumberReservations!.some(r=>r.invoiceNumber==='CIJDTI2026016'));assert.equal(db.taxImportHistory![2].displayedNumber,'CIJDTI2026005.');assert.equal(nextInvoiceNumber(db,2026,false),'CIJDTI2026046');
});
test('missing date/rate/totals and unsafe items stay null and Needs review; trusted header kept',()=>{
 const db=buildV5Seed();importTaxHistory(db,book([source(1,{invoiceDate:null,exchangeRate:null,items:[],totals:{subtotalUsd:null,vatUsd:null,totalUsd:null,totalKhr:null}})]));const r=db.taxImportHistory![0];assert.equal(r.importStatus,'Needs review');assert.equal(r.exchangeRate,null);assert.equal(r.totals.totalUsd,null);assert.equal(r.customer.companyNameEn,C.companyNameEn);assert.equal(db.taxInvoices!.length,0);
});
test('valid cancelled invoice imports cancelled and keeps number unavailable',()=>{const db=buildV5Seed();importTaxHistory(db,book([source(9,{cancelled:true})]));assert.equal(db.taxInvoices![0].status,'CANCELLED');assert.equal(nextInvoiceNumber(db,2026,false),'CIJDTI2026010');});
test('numbering includes existing ledger, historical reservations, cancelled and per-year numbers',()=>{const db=buildV5Seed();db.invoices.push({invoiceNumber:'CIJDTI2026088'} as never);db.invoiceNumberReservations=[{invoiceNumber:'CIJDTI2026090',ownerId:'reserved',sourceId:'s',reason:'cancelled'}];assert.equal(nextInvoiceNumber(db,2026,false),'CIJDTI2026091');assert.equal(nextInvoiceNumber(db,2027,false),'CIJDTI2027001');});
test('draft permits incomplete input; repeat saves reserve no numbers; issue retries reuse the same invoice; cancelled number never reused',async()=>{
 const db=buildV5Seed();const c=saveCustomer(db,{...C,name:'Example',actor:'QA'});const d=saveInvoiceDraft(db,{customerId:c.id},'QA');assert.equal(d.status,'DRAFT');assert.equal(db.taxInvoices!.length,0);assert.equal(nextInvoiceNumber(db,2026,false),'CIJDTI2026001');
 saveInvoiceDraft(db,{...input(c.id)},'QA',d.id,d.revision);assert.equal(nextInvoiceNumber(db,2026,false),'CIJDTI2026001');const r=issueSavedDraft(db,d.id,input(c.id),'QA',d.revision);assert.equal(issueSavedDraft(db,d.id,input(c.id),'QA',d.revision).id,r.id);assert.equal(db.taxInvoices!.length,1);cancelInvoice(db,r.id,'QA cancellation','QA');assert.equal(issueInvoice(db,input(c.id)).invoiceNumber,'CIJDTI2026002');
});
test('invalid issue fails without consuming draft or number',()=>{const db=buildV5Seed();const d=saveInvoiceDraft(db,{invoiceDate:''},'QA');assert.throws(()=>issueSavedDraft(db,d.id,{invoiceDate:''},'QA',d.revision));assert.equal(d.status,'DRAFT');assert.equal(nextInvoiceNumber(db,2026,false),'CIJDTI2026001');});
test('concurrent D1 issues commit at most one number; retry sees committed history',async()=>{
 const d1=sqliteD1();const seedP=d1Persistence(d1,buildV5Seed);const seed=(await seedP.read())!;const c=saveCustomer(seed,{...C,name:'Example',actor:'QA'});await seedP.write(seed);
 const p1=d1Persistence(d1,buildV5Seed),p2=d1Persistence(d1,buildV5Seed);const a=(await p1.read())!,b=(await p2.read())!;issueInvoice(a,input(c.id));issueInvoice(b,input(c.id));const results=await Promise.allSettled([p1.write(a),p2.write(b)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const p=d1Persistence(d1,buildV5Seed);const next=(await p.read())!;assert.equal(issueInvoice(next,input(c.id)).invoiceNumber,'CIJDTI2026002');await p.write(next);assert.equal((d1.raw.prepare('SELECT count(*) n FROM v5_invoice_numbers').get() as {n:number}).n,2);
});
test('SQL rejects an already consumed owner and rolls back every write',async()=>{const d1=sqliteD1();const p=d1Persistence(d1,buildV5Seed);const db=(await p.read())!;db.invoiceNumberReservations=[{invoiceNumber:'CIJDTI2026009',ownerId:'a',sourceId:'s',reason:'cancelled'}];await p.write(db);const read=(await p.read())!;read.invoiceNumberReservations![0].ownerId='b';const version=(d1.raw.prepare('SELECT version FROM v5_meta').get() as {version:number}).version;await assert.rejects(p.write(read),/already consumed/);assert.equal((d1.raw.prepare('SELECT version FROM v5_meta').get() as {version:number}).version,version);});
test('new Customer Master rejects duplicate normalized VATIN and legal name',()=>{const db=buildV5Seed();saveCustomer(db,{...C,name:'Example',actor:'QA'});assert.throws(()=>saveCustomer(db,{...C,name:'Another',actor:'QA'}),/VATIN/);assert.throws(()=>saveCustomer(db,{companyNameEn:' EXAMPLE CO LTD ',name:'Alias',actor:'QA'}),/already registered/);});
