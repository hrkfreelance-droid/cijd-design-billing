import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildV5Seed} from '../../src/lib/billing-v5/repository.ts';
import {createWorkProject,projectWorkType,workSnapshot,invoiceWorkTypes,invoiceArea} from '../../src/lib/billing-v5/work-types.ts';
import {issueInvoice,nextInvoiceNumber,saveCustomer} from '../../src/lib/billing-v5/invoicing.ts';
import {Store} from '../../src/lib/data/store.ts';
import {d1Persistence} from '../../src/lib/billing-v5/d1-persistence.ts';
import {sqliteD1} from './d1-sqlite.ts';
import type {Snapshot,TaxInvoiceRecord} from '../../src/lib/types.ts';

test('legacy work stays DESIGN without changing a stored project; other work is isolated with shared customers',async()=>{
 const p=d1Persistence(sqliteD1(),buildV5Seed);const db=(await p.read())!; db.clients.push({id:'c',name:'Existing Customer',active:true,createdAt:'2026-01-01'});
 const design=createWorkProject(db,{clientId:'c',name:'Existing Design'},'QA');delete design.workType;
 const before=JSON.stringify(design);const other=createWorkProject(db,{clientId:'c',name:'Other',workType:'OTHER_BUSINESS'},'QA');
 assert.equal(projectWorkType(design),'DESIGN');assert.equal(JSON.stringify(design),before);
 await p.write(db);const snapshot=await new Store(p).getSnapshot();
 assert.deepEqual(workSnapshot(snapshot,'DESIGN').projects.map(p=>p.id),[design.id]);
 assert.deepEqual(workSnapshot(snapshot,'OTHER_BUSINESS').projects.map(p=>p.id),[other.id]);
 assert.equal(workSnapshot(snapshot,'OTHER_BUSINESS').clients.length,1);
 assert.throws(()=>createWorkProject(db,{clientId:'c',name:'Bad',workType:'OTHER'},'QA'),/Unknown work type/);
});

test('both work categories use one global invoice sequence and freeze their sources',async()=>{
 const p=d1Persistence(sqliteD1(),buildV5Seed);const db=(await p.read())!;const customer=saveCustomer(db,{name:'Real customer',companyNameEn:'Real Customer Ltd',actor:'QA'});
 const rows=[];
 for(const workType of ['DESIGN','OTHER_BUSINESS'] as const){
  const project=createWorkProject(db,{clientId:customer.id,name:workType,workType},'QA'); project.billingReadiness='ACCOUNTING';
  rows.push(project);db.billingItems.push({id:workType,projectId:project.id,description:workType,type:'DESIGN',quantity:1,unitPrice:10,amount:10,customAmount:true,productionStatus:'COMPLETED',billingStatus:'NOT_READY',createdAt:'2026-01-01',updatedAt:'2026-01-01',createdBy:'QA',updatedBy:'QA'} as typeof db.billingItems[number]);
 }
 const input=(id:string)=>({customerId:customer.id,invoiceDate:'2026-10-07',customer:{companyNameEn:'Real Customer Ltd'},items:[{billingItemId:id,description:id,quantity:1,unitPrice:10}],exchangeRate:{rate:4000,source:'MANUAL' as const},actor:'QA'});
 const a=issueInvoice(db,input('DESIGN'));const b=issueInvoice(db,input('OTHER_BUSINESS'));
 assert.equal(a.invoiceNumber,'CIJDTI2026001');assert.equal(b.invoiceNumber,'CIJDTI2026002');assert.equal(nextInvoiceNumber(db,2026,false), 'CIJDTI2026003');
 assert.deepEqual(a.workTypes,['DESIGN']);assert.deepEqual(b.workTypes,['OTHER_BUSINESS']);
 await p.write(db);const snapshot=await new Store(p).getSnapshot();
 assert.equal(workSnapshot(snapshot,'DESIGN').taxInvoices?.length,1);assert.equal(workSnapshot(snapshot,'OTHER_BUSINESS').taxInvoices?.length,1);
 assert.deepEqual(invoiceWorkTypes(snapshot,b),['OTHER_BUSINESS']);
 rows[1].workType='DESIGN';assert.deepEqual(invoiceWorkTypes({projects:rows} as Snapshot,b),['OTHER_BUSINESS']);
 const unlinked={...a,projectId:'',projectIds:[],workTypes:[]} as TaxInvoiceRecord;assert.equal(invoiceArea(snapshot,unlinked),'SHARED');
 const mixed={...a,workTypes:['DESIGN','OTHER_BUSINESS']} as TaxInvoiceRecord;assert.equal(invoiceArea(snapshot,mixed),'SHARED');
});
