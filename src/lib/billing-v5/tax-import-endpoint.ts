import { RuleError } from '../data/repository';
import { getV5Persistence, v5Secret } from './repository';
import { isV5Server } from './runtime';
import { importTaxHistory, type WorkbookImport } from './tax-history';

export async function taxImportPOST(request:Request){
 if(!isV5Server())return Response.json({ok:false},{status:404});
 const token=v5Secret('V5_TAX_IMPORT_TOKEN');
 if(!token)return Response.json({ok:false},{status:404});
 const given=(request.headers.get('authorization')??'').replace(/^Bearer\s+/i,'');
 let diff=token.length^given.length;for(let i=0;i<Math.max(token.length,given.length);i++)diff|=(token.charCodeAt(i)||0)^(given.charCodeAt(i)||0);
 if(diff)return Response.json({ok:false,code:'UNAUTHENTICATED'},{status:401});
 try{
  const body=await request.json() as WorkbookImport;
  const p=getV5Persistence();const db=(await p.read())!;
  const result=importTaxHistory(db,body);
  if(result.staged)await p.write(db);
  return Response.json({ok:true,data:result});
 }catch(e){if(e instanceof RuleError)return Response.json({ok:false,code:e.code,message:e.message},{status:e.status});console.error('[tax-import]',e);return Response.json({ok:false,code:'IMPORT_FAILED'},{status:500});}
}
