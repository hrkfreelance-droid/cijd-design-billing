#!/usr/bin/env python3
"""Read XLSX cells AND worksheet-linked DrawingML text. Never repair source values."""
import argparse, collections, datetime, hashlib, json, math, pathlib, posixpath, re, unicodedata, zipfile
import xml.etree.ElementTree as ET
S='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
A='http://schemas.openxmlformats.org/drawingml/2006/main'
R='http://schemas.openxmlformats.org/package/2006/relationships'
X='http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'
NS={'s':S,'a':A,'x':X}
def clean(s): return re.sub(r'[\u200b-\u200f\ufeff]', '', s or '').strip()
def between(text,label,end):
 m=re.search(label+r'\s*[:៖]?\s*(.*?)'+end,text,re.S|re.I)
 return clean(m.group(1)) if m else ''
def numeric(v):
 try:
  f=float(v)
  return f if math.isfinite(f) else None
 except (TypeError,ValueError): return None
def relationships(z,part):
 p=posixpath.join(posixpath.dirname(part),'_rels',posixpath.basename(part)+'.rels')
 if p not in z.namelist(): return {}
 return {e.attrib['Id']:posixpath.normpath(posixpath.join(posixpath.dirname(part),e.attrib['Target'])) if not e.attrib['Target'].startswith('/') else e.attrib['Target'].lstrip('/') for e in ET.fromstring(z.read(p)) if e.attrib.get('TargetMode')!='External'}
def parse(path):
 content=pathlib.Path(path).read_bytes(); sha=hashlib.sha256(content).hexdigest(); result=[];verifiedRateCells=set()
 with zipfile.ZipFile(path) as z:
  if z.testzip(): raise ValueError('Corrupt XLSX package')
  shared=[]
  if 'xl/sharedStrings.xml' in z.namelist(): shared=[''.join(e.itertext()) for e in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si',NS)]
  wb=ET.fromstring(z.read('xl/workbook.xml')); rel=relationships(z,'xl/workbook.xml')
  for sheet in wb.findall('s:sheets/s:sheet',NS):
   name=sheet.attrib['name']; part=rel[sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']]; tree=ET.fromstring(z.read(part)); cells={}
   for c in tree.findall('.//s:c',NS):
    v=c.find('s:v',NS); f=c.find('s:f',NS); value=v.text if v is not None else None
    if c.attrib.get('t')=='s' and value is not None: value=shared[int(value)]
    elif c.attrib.get('t')=='inlineStr': value=''.join(c.find('s:is',NS).itertext())
    elif c.attrib.get('t') not in ('str','e','b'): value=numeric(value)
    if value is not None or f is not None: cells[c.attrib['r']]={'value':value,'formula':f.attrib|{'text':f.text} if f is not None else None,'type':c.attrib.get('t'),'style':c.attrib.get('s')}
   drawings=[]; srel=relationships(z,part)
   for d in tree.findall('s:drawing',NS):
    dp=srel[d.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']]
    for anchor in ET.fromstring(z.read(dp)):
     for sp in anchor.findall('.//x:sp',NS):
      paragraphs=[''.join(p.itertext()) for p in sp.findall('.//a:p',NS)]
      if paragraphs:
       drawings.append({'part':dp,'text':'\n'.join(paragraphs),'fromRow':anchor.findtext('x:from/x:row',default='',namespaces=NS),'fromCol':anchor.findtext('x:from/x:col',default='',namespaces=NS)})
   # Seller/company footer is a separate shape and must never become the customer.
   buyer=[d['text'] for d in drawings if not ('K002-901900787' in d['text'] or 'Bank name' in d['text'] or 'Signature' in d['text'])]
   text=clean('\n'.join(buyer)); stop=r'(?=\n|Company Name|Address\s*:|Telephone No|អាស័យដ្ឋាន|លេខអត្តសញ្ញាណ|ទូរស័ព្ទ|កាលបរិច្ឆ|Date\s*[:៖]|$)'
   customer={
    'companyNameEn':between(text,r'Company Name\s*/\s*Customer',stop),
    'companyNameKm':between(text,r'ឈ្មោះក្រុមហ៊ុន ឬអតិថិជន',stop),
    'addressEn':between(text,r'Address',stop),
    'addressKm':between(text,r'អាស័យដ្ឋាន',stop),
    'telephone':between(text,r'Telephone No\.?',stop),
    'vatin':between(text,r'\(VATIN\)',stop),
   }
   # Khmer phone is retained when the English phone box is absent, never guessed.
   if not customer['telephone']: customer['telephone']=between(text,r'ទូរស័ព្ទលេខ',stop)
   nums=re.findall(r'Invoice No\.?\s*[:៖]?\s*([^\s\nក]+)',text,re.I)
   number=nums[0] if len(set(nums))==1 else ''
   dateRaw=between(text,r'Date',r'(?=\n|$)'); date=None
   for fmt in ['%d-%B-%Y','%d-%b-%Y','%d %B %Y','%d/%m/%Y','%Y-%m-%d']:
    try: date=datetime.datetime.strptime(dateRaw,fmt).date().isoformat();break
    except ValueError: pass
   value=lambda ref: cells.get(ref,{}).get('value')
   rate=None
   for ref,c in cells.items():
    if isinstance(c['value'],str) and clean(c['value']).lower()=='exchange rate':
     m=re.fullmatch(r'([A-Z]+)(\d+)',ref); rate=numeric(value(chr(ord(m.group(1))+1)+m.group(2))) if len(m.group(1))==1 else None
   header=next((int(re.search(r'\d+',ref).group()) for ref,c in cells.items() if clean(str(c['value'])).lower()=='description'),None)
   for ref,c in cells.items():
    if isinstance(c['value'],str) and clean(c['value']).lower()=='exchange rate':
     m=re.fullmatch(r'([A-Z])(\d+)',ref)
     if m:
      rateRef=chr(ord(m.group(1))+1)+m.group(2)
      verifiedRateCells.add((header,rateRef,cells.get(rateRef,{}).get('style')))
   issues=[]; items=[]; totals={'subtotalUsd':None,'vatUsd':None,'totalUsd':None,'totalKhr':None}
   discountUsd=0;taxableUsd=None
   if header is not None:
    labels={clean(str(c['value'])).lower():re.sub(r'\d+','',ref) for ref,c in cells.items() if re.search(r'\d+',ref) and int(re.search(r'\d+',ref).group())==header}
    dc,qc,pc,ac=[labels.get(k) for k in ['description','quantity','unit price','amount']]
    subtotalRows=[int(re.search(r'\d+',ref).group()) for ref,c in cells.items() if ac and ref.startswith(ac) and c['formula'] and re.fullmatch(r'SUM\('+ac+str(header+1)+':'+ac+r'\d+\)',c['formula'].get('text') or '',re.I)]
    if len(subtotalRows)==1 and all([dc,qc,pc,ac]):
     end=subtotalRows[0]
     for row in range(header+1,end):
      desc=value(dc+str(row));qty=numeric(value(qc+str(row)));price=numeric(value(pc+str(row)));amount=numeric(value(ac+str(row)))
      if desc is None and qty is None and price is None and amount in (None,0):continue
      if not isinstance(desc,str) or not clean(desc) or qty is None or qty<=0 or price is None or price<0 or amount is None or abs(qty*price-amount)>.011:
       issues.append('UNSAFE_ITEM:'+str(row));continue
      items.append({'description':clean(desc),'quantity':qty,'unitPrice':price,'amount':amount,'sourceRow':row})
     hasDiscount=any('Discount' in d['text'] for d in drawings)
     if hasDiscount:
      # This historical layout explicitly subtracts a discount before its VAT row.
      discountUsd=numeric(value(ac+str(end+1)));taxableUsd=numeric(value(ac+str(end+2)))
      refs=[end,end+3,end+4,end+5]
      if discountUsd is None or taxableUsd is None or abs((numeric(value(ac+str(end))) or 0)-discountUsd-taxableUsd)>.011:issues.append('UNSAFE_DISCOUNT')
     else:refs=[end+i for i in range(4)]
     totals=dict(zip(totals,[numeric(value(ac+str(r))) for r in refs]))
     if rate is None:
      formula=(cells.get(ac+str(refs[-1]),{}).get('formula') or {}).get('text') or ''
      m=re.fullmatch(re.escape(ac+str(refs[-2]))+r'\*([A-Z]+\d+)',formula,re.I)
      if m:
       rate=numeric(value(m.group(1)));issues.append('RATE_FROM_FORMULA_REFERENCE')
    else:issues.append('UNKNOWN_TOTAL_LAYOUT')
   else:issues.append('UNKNOWN_ITEM_LAYOUT')
   if not re.fullmatch(r'CIJDTI2026\d{3}',number):issues.append('MALFORMED_DISPLAYED_NUMBER')
   if name!=clean(name):issues.append('SHEET_ZERO_WIDTH')
   if not re.fullmatch(r'CIJDTI2026\d{3}',clean(name)):issues.append('MALFORMED_SHEET_NAME')
   if clean(name)!=number:issues.append('SHEET_DISPLAY_MISMATCH')
   if not date:issues.append('UNKNOWN_DATE')
   for key,v in customer.items():
    if not v:issues.append('UNKNOWN_'+key.upper())
   if rate is None or rate<=0:issues.append('UNKNOWN_EXCHANGE_RATE')
   if not items:issues.append('NO_SAFE_ITEMS')
   if any(v is None for v in totals.values()):issues.append('UNKNOWN_TOTALS')
   else:
    st,vat,usd,khr=totals.values()
    if abs(sum(i['amount'] for i in items)-st)>.011:issues.append('ITEM_SUBTOTAL_MISMATCH')
    if abs((taxableUsd if taxableUsd is not None else st)*.1-vat)>.011:issues.append('VAT_MISMATCH')
    if abs((taxableUsd if taxableUsd is not None else st)+vat-usd)>.011:issues.append('USD_TOTAL_MISMATCH')
    if rate and abs(usd*rate-khr)>.51:issues.append('KHR_TOTAL_MISMATCH')
   cancelled=bool(re.search(r'cancel|cancal|void',name+'\n'+text,re.I))
   result.append({'id':sha+':'+sheet.attrib['sheetId'],'sourceSha256':sha,'sourceFile':pathlib.Path(path).name,'sheet':name,'sheetId':sheet.attrib['sheetId'],'displayedNumber':number,'invoiceDate':date,'dateRaw':dateRaw,'customer':customer,'exchangeRate':rate,'items':items,'totals':totals,'discountUsd':discountUsd,'taxableUsd':taxableUsd,'cancelled':cancelled,'issues':issues,'raw':{'worksheet':part,'cells':cells,'drawings':drawings,'sheetAttributes':sheet.attrib,'itemHeaderRow':header,'mergedCells':[e.attrib['ref'] for e in tree.findall('s:mergeCells/s:mergeCell',NS)]}})
  # Two source sheets omit the rate label but retain the exact rate cell/style
  # of the same workbook template. Report the missing label, retain the cell value.
  for r in result:
   if 'UNKNOWN_EXCHANGE_RATE' not in r['issues']:continue
   candidates=[(ref,c['value']) for ref,c in r['raw']['cells'].items() if (r['raw']['itemHeaderRow'],ref,c.get('style')) in verifiedRateCells and isinstance(c['value'],(float,int)) and c['value']>0]
   if len(candidates)==1:
    ref,rate=candidates[0];r['exchangeRate']=rate;r['issues'].remove('UNKNOWN_EXCHANGE_RATE');r['issues'].append('RATE_LABEL_MISSING_VERIFIED_TEMPLATE_CELL:'+ref)
    if r['totals']['totalUsd'] is not None and r['totals']['totalKhr'] is not None and abs(r['totals']['totalUsd']*rate-r['totals']['totalKhr'])>.51:r['issues'].append('KHR_TOTAL_MISMATCH')
  groups=collections.defaultdict(list)
  for r in result:groups[r['displayedNumber']].append(r)
  for n,rows in groups.items():
   if n and len(rows)>1:
    for r in rows:r['issues'].append('DUPLICATE_DISPLAYED_NUMBER')
  valid=[int(r['displayedNumber'][-3:]) for r in result if re.fullmatch(r'CIJDTI2026\d{3}',r['displayedNumber'])]
  return {'version':1,'sourceSha256':sha,'sourceFile':pathlib.Path(path).name,'sheets':result,'summary':{'sheets':len(result),'drawingShapes':sum(len(r['raw']['drawings']) for r in result),'cancelledSheets':sum(r['cancelled'] for r in result),'highestDisplayedNumber':'CIJDTI2026'+str(max(valid)).zfill(3) if valid else None,'missingDisplayedSequences':[i for i in range(1,max(valid)+1) if i not in valid] if valid else [],'issues':dict(collections.Counter(i for r in result for i in r['issues']))}}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('source');p.add_argument('output');a=p.parse_args();data=parse(a.source);pathlib.Path(a.output).write_text(json.dumps(data,ensure_ascii=False,indent=2));print(json.dumps(data['summary'],ensure_ascii=False,indent=2))
