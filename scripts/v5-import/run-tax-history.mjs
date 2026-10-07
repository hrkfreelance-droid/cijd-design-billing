import {readFileSync,writeFileSync} from 'node:fs';
const [target,workbook,tokenFile,reportFile]=process.argv.slice(2);
if(target!=='http://127.0.0.1:8791' && target!=='https://cijd-design-billing-v5-preview.hrk-freelance.workers.dev')throw Error('Only the approved V5 target is allowed');
const token=readFileSync(tokenFile,'utf8').trim();const data=readFileSync(workbook,'utf8');
async function run(){const response=await fetch(target+'/api/v5/tax-history/import',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:data});const result=await response.json();if(!response.ok||!result.ok)throw Error(JSON.stringify(result));return result.data;}
const first=await run();const second=await run();if(second.staged||second.customersAdded||second.invoicesAdded)throw Error('Second import was not idempotent');writeFileSync(reportFile,JSON.stringify({first,second},null,2));console.log(JSON.stringify({first,second},null,2));
