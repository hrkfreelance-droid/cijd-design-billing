import {readJson} from '@/lib/api';
import {handleV5} from '@/lib/billing-v5/api';
import {getV5Persistence} from '@/lib/billing-v5/repository';
import {saveInvoiceDraft} from '@/lib/billing-v5/drafts';
export const dynamic='force-dynamic';
export async function GET(){return handleV5(['invoice:write','payment:read'],async()=>{const db=(await getV5Persistence().read())!;return db.invoiceDrafts??[];});}
export async function POST(request:Request){const b=await readJson(request);return handleV5(['invoice:write','payment:write'],async(_store,user)=>{const p=getV5Persistence();const db=(await p.read())!;const draft=saveInvoiceDraft(db,b.input as Record<string,unknown>??{},user.name,typeof b.id==='string'?b.id:undefined,typeof b.revision==='number'?b.revision:undefined);await p.write(db);return draft;});}
