import {readFileSync,writeFileSync} from 'node:fs';
import {sqliteD1} from '../../tests/unit/d1-sqlite.ts';
import {d1Persistence} from '../../src/lib/billing-v5/d1-persistence.ts';
import {buildV5Seed} from '../../src/lib/billing-v5/repository.ts';
import {importTaxHistory} from '../../src/lib/billing-v5/tax-history.ts';
const [backup,workbook,output]=process.argv.slice(2);
const d1=sqliteD1({initialSql:readFileSync(backup,'utf8')});
const p=d1Persistence(d1,buildV5Seed);const db=(await p.read())!;
const before=structuredClone(db);const book=JSON.parse(readFileSync(workbook,'utf8'));
const first=importTaxHistory(db,book);await p.write(db);
const after=(await p.read())!;const second=importTaxHistory(after,book);
const preserved=['projects','billingItems','invoices','invoiceItems','payments','projectPayments','clientTaxProfiles','exchangeRates','products','billingAllocations','invoicePayments'] as const;
for(const key of preserved){if(JSON.stringify(before[key])!==JSON.stringify(after[key]))throw Error(`Existing collection changed: ${key}`);}
for(const key of ['customers','clients','taxInvoices','invoiceRevisions'] as const)for(const r of before[key]??[])if(JSON.stringify(r)!==JSON.stringify(after[key]?.find(e=>e.id===r.id)))throw Error(`Existing record changed: ${key}:${r.id}`);
if(second.staged||second.customersAdded||second.invoicesAdded)throw Error('Not idempotent');
writeFileSync(output,JSON.stringify({first,second,preservation:'PASS',entries:after.taxImportHistory?.map(({raw,...r})=>r)},null,2));
console.log(JSON.stringify({first,second,preservation:'PASS'},null,2));
