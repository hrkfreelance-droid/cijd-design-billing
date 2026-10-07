import importlib.util,json,pathlib,tempfile,unittest,zipfile
spec=importlib.util.spec_from_file_location('parser',pathlib.Path(__file__).with_name('parse-tax-workbook.py'));parser=importlib.util.module_from_spec(spec);spec.loader.exec_module(parser)
class ParserTests(unittest.TestCase):
 def test_relationships_drawing_customer_seller_excluded_cached_formulas_merges(self):
  with tempfile.TemporaryDirectory() as d:
   file=pathlib.Path(d)/'fixture.xlsx'
   with zipfile.ZipFile(file,'w') as z:
    z.writestr('xl/workbook.xml','<workbook xmlns="'+parser.S+'" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="CIJDTI2026001" sheetId="42" r:id="r7"/></sheets></workbook>')
    z.writestr('xl/_rels/workbook.xml.rels','<Relationships xmlns="'+parser.R+'"><Relationship Id="r7" Target="worksheets/sheet37.xml"/></Relationships>')
    cells={'D14':('Exchange Rate','str'),'E14':('4000','n'),'B19':('Description','str'),'C19':('quantity','str'),'D19':('Unit Price','str'),'E19':('Amount','str'),'B20':('Design','str'),'C20':('2','n'),'D20':('10','n'),'E20':('20','n'),'E21':('20','n'),'E22':('2','n'),'E23':('22','n'),'E24':('88000','n')}
    tags=''.join('<c r="'+k+'" t="'+t+'">'+('<f>SUM(E20:E20)</f>' if k=='E21' else '<f>C20*D20</f>' if k=='E20' else '')+'<v>'+v+'</v></c>' for k,(v,t) in cells.items())
    z.writestr('xl/worksheets/sheet37.xml','<worksheet xmlns="'+parser.S+'" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData><row>'+tags+'</row></sheetData><mergeCells><mergeCell ref="A1:E1"/></mergeCells><drawing r:id="d9"/></worksheet>')
    z.writestr('xl/worksheets/_rels/sheet37.xml.rels','<Relationships xmlns="'+parser.R+'"><Relationship Id="d9" Target="../drawings/drawing99.xml"/></Relationships>')
    texts=['Company Name / Customer៖ Example Co., Ltd.','Address: Phnom Penh','Telephone No. 012','(VATIN) VAT-123','Invoice No. CIJDTI2026001Date៖ 01-January-2026','(VATIN) K002-901900787 Address: SELLER Telephone No. SELLER']
    z.writestr('xl/drawings/drawing99.xml','<x:wsDr xmlns:x="'+parser.X+'" xmlns:a="'+parser.A+'">'+''.join('<x:twoCellAnchor><x:sp><x:txBody><a:p><a:r><a:t>'+t+'</a:t></a:r></a:p></x:txBody></x:sp></x:twoCellAnchor>' for t in texts)+'</x:wsDr>')
   book=parser.parse(file);r=book['sheets'][0]
   self.assertEqual(r['customer']['companyNameEn'],'Example Co., Ltd.');self.assertEqual(r['customer']['vatin'],'VAT-123');self.assertEqual(r['invoiceDate'],'2026-01-01');self.assertEqual(r['raw']['worksheet'],'xl/worksheets/sheet37.xml');self.assertEqual(r['raw']['drawings'][0]['part'],'xl/drawings/drawing99.xml');self.assertEqual(r['raw']['mergedCells'],['A1:E1']);self.assertEqual(r['raw']['cells']['E20']['formula']['text'],'C20*D20');self.assertEqual(r['totals']['totalUsd'],22);self.assertEqual(r['items'][0]['quantity'],2)
 def test_missing_and_malformed_are_not_guessed(self):
  self.assertEqual(parser.clean('CIJD\u200b'),'CIJD');self.assertIsNone(parser.numeric('UNKNOWN'));self.assertEqual(parser.between('Address:ទូរស័ព្ទលេខ៖',r'Address',r'(?=ទូរស័ព្ទ|$)'), '')
if __name__=='__main__':unittest.main()
