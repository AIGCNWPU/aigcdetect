from pathlib import Path
import os
import json,hashlib
import pypdfium2 as pdfium
root=Path(os.environ['AIGC_PLATFORM_ROOT']);data=root/'datasets/documents/invoice-benchmark-20261106';out=root/'runtime/replay/invoice-benchmark-20261106'
rows=json.loads((data/'selected.json').read_text())['samples'];inputs=[]
for row in rows:
 p=Path(row['path']);assert hashlib.sha256(p.read_bytes()).hexdigest()==row['sha256']
 doc=pdfium.PdfDocument(str(p));blocks=[]
 for n,page in enumerate(doc):
  txt=page.get_textpage().get_text_range();lines=[x.strip() for x in txt.splitlines() if x.strip()]
  for i,line in enumerate(lines):blocks.append({'id':f'p{n+1}-b{i+1}','text':line,'confidence':1,'page':n+1})
  if n==0:page.render(scale=1.5).to_pil().save(out/(row['id']+'.png'))
 inputs.append({'id':row['id'],'sha256':row['sha256'],'textBlocks':blocks,'parser':'pypdfium2 embedded PDF text; not OCR'})
(out/'inputs.json').write_text(json.dumps(inputs,indent=2))
print('Parsed',len(inputs),'PDFs; blocks:',[len(x['textBlocks']) for x in inputs])
