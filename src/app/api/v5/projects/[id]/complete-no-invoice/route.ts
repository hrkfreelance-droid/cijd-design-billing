import {handleV5} from "@/lib/billing-v5/api";
import {getV5Persistence} from "@/lib/billing-v5/repository";
export async function POST(_request:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;
 return handleV5(["production:write"],async(_store,user)=>{
  const persistence=getV5Persistence();const db=(await persistence.read())!;
  const project=db.projects.find(row=>row.id===id&&!row.deletedAt);
  if(!project)throw new Error("Project was not found.");
  if((db.billingAllocations??[]).some(a=>!a.voidedAt&&db.billingItems.some(i=>i.id===a.billingItemId&&i.projectId===id)))throw new Error("This project already has invoiced work.");
  project.billingDisposition="NO_INVOICE";project.updatedAt=new Date().toISOString();project.updatedBy=user.name;
  db.auditLogs.push({id:crypto.randomUUID(),at:project.updatedAt,actor:user.name,action:"project.complete_no_invoice",entity:"project",entityId:id,detail:project.name});
  await persistence.write(db);return project;
 });
}
