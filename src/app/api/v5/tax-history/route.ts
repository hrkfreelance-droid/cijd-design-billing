import {handleV5} from '@/lib/billing-v5/api';
import {getV5Persistence} from '@/lib/billing-v5/repository';
import {highestNumber} from '@/lib/billing-v5/tax-history';
import {nextInvoiceNumber} from '@/lib/billing-v5/invoicing';
export const dynamic='force-dynamic';
export async function GET(){return handleV5(['invoice:write','payment:read'],async()=>{const db=(await getV5Persistence().read())!;return {history:db.taxImportHistory??[],highest:highestNumber(db,2026),next:nextInvoiceNumber(db,2026,false)};});}
