import {handleV5} from '@/lib/billing-v5/api';
import {getV5Persistence} from '@/lib/billing-v5/repository';
import {isTestCustomer,nextInvoiceNumber} from '@/lib/billing-v5/invoicing';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const url=new URL(request.url);const year=Number(url.searchParams.get('year'));
 if(!Number.isInteger(year)||year<2000||year>9999)return Response.json({ok:false,code:'INVALID'},{status:400});
 return handleV5(['invoice:write','payment:read'],async()=>{const db=(await getV5Persistence().read())!;const client=db.clients.find(c=>c.id===url.searchParams.get('customerId'));return {invoiceNumber:nextInvoiceNumber(db,year,isTestCustomer(client?.name??'')),reserved:false};});
}
