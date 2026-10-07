import { RuleError } from '../data/repository';
import type { Database } from '../types';
import type { InvoiceDraft } from './tax-history';
import { invoiceInputFrom } from './invoice-input';
import { issueInvoice } from './invoicing';

export function saveInvoiceDraft(db:Database, input:Record<string,unknown>, actor:string, id?:string, expectedRevision?:number):InvoiceDraft {
 db.invoiceDrafts??=[];
 const existing=id?db.invoiceDrafts.find(d=>d.id===id):undefined;
 if(id&&!existing&&expectedRevision!==0)throw new RuleError('NOT_FOUND','Draft was not found.',404);
 if(existing && existing.status==='DRAFT' && existing.revision===(expectedRevision??-1)+1 && JSON.stringify(existing.input)===JSON.stringify(input))return existing;
 if(existing&&existing.status!=='DRAFT')throw new RuleError('DRAFT_CLOSED','This draft was already issued or cancelled.',409);
 if(existing && existing.revision!==expectedRevision)throw new RuleError('CONFLICT','Draft changed. Reload before saving.',409);
 const at=new Date().toISOString();
 const draft:InvoiceDraft={id:existing?.id??id??crypto.randomUUID(),status:'DRAFT',input:structuredClone(input),createdAt:existing?.createdAt??at,updatedAt:at,actor,revision:(existing?.revision??0)+1,issuedInvoiceId:null};
 // Drafts are deliberately unnumbered and may contain incomplete fields.
 delete draft.input.invoiceNumber;delete draft.input.draftId;delete draft.input.draftRevision;
 if(existing)Object.assign(existing,draft);else db.invoiceDrafts.push(draft);
 return draft;
}
export function issueSavedDraft(db:Database,id:string,input:Record<string,unknown>,actor:string,expectedRevision:number){
 const draft=db.invoiceDrafts?.find(d=>d.id===id);
 if(!draft)throw new RuleError('NOT_FOUND','Draft was not found.',404);
 if(draft.issuedInvoiceId){const issued=db.taxInvoices?.find(i=>i.id===draft.issuedInvoiceId);if(issued)return issued;}
 if(draft.status!=='DRAFT'||draft.revision!==expectedRevision)throw new RuleError('CONFLICT','Draft changed. Reload before issuing.',409);
 const invoice=issueInvoice(db,invoiceInputFrom(input,actor));
 draft.status='ISSUED';draft.issuedInvoiceId=invoice.id;draft.updatedAt=new Date().toISOString();draft.revision++;
 return invoice;
}
