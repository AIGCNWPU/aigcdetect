from pathlib import Path
import os
import json,subprocess,hashlib
root=Path(os.environ['AIGC_PLATFORM_ROOT']);base=root/'datasets/documents/invoice-benchmark-20261106';tree=json.loads((base/'tree.json').read_text());rev=tree['sha'];url=f'https://raw.githubusercontent.com/DrewKraken/invoice-extraction-benchmark/{rev}/'
subprocess.run(['curl','-fsSL','--max-time','45',url+'corpus/v1/manifest.json','-o',str(base/'frozen-manifest.json')],check=True)
allrows=json.loads((base/'frozen-manifest.json').read_text())['documents']
ids=['clean-us-clean-simple','hard-total-inflated','clean-us-with-shipping','hard-lines-vs-subtotal','clean-us-with-discount','hard-total-small-residual','tax-inclusive-total-za','hard-wrong-vat-amount']
rows=[]
for n,id in enumerate(ids,1):
 r=next(x for x in allrows if x['doc_id']==id);dest=base/r['file'];dest.parent.mkdir(exist_ok=True)
 subprocess.run(['curl','-fsSL','--max-time','45',url+'corpus/v1/'+r['file'],'-o',str(dest)],check=True)
 assert hashlib.sha256(dest.read_bytes()).hexdigest()==r['sha256']
 rows.append({'id':f'doc-{n:02}',**r,'path':str(dest)})
(base/'selected.json').write_text(json.dumps({'revision':rev,'source':'https://github.com/DrewKraken/invoice-extraction-benchmark','license':'CC-BY-4.0','sampling':'4 published arithmetic anomaly cases plus 4 controls fixed before running','samples':rows},indent=2))
print('Downloaded and checksum verified',len(rows),'PDFs')
