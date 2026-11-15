"""Reuse image receipt evidence rules on PDF pages with parent-page provenance."""
import argparse,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'src/modules/image/documents/python'))
from pdf_evidence import bind_pdf_ocr
from receipt_evidence import fuse

def fuse_pdf_pages(manifest,ocr):
    bound=bind_pdf_ocr(manifest,ocr)
    samples={s['sample_id']:s for s in ocr['samples']}
    results=[]
    for page in bound['pages']:
        record={'page':page['page'],'ocr_status':page['ocr_status'],'rules_status':'not_run','result':None}
        if page['ocr_status']=='succeeded':
            sample=dict(samples[f"pdf-page-{page['page']}"],regions=page['regions'])
            try:
                record.update(rules_status='succeeded',result=fuse(sample))
            except (ValueError,KeyError,TypeError) as error:
                record.update(rules_status='failed',error=type(error).__name__)
        results.append(record)
    return {'schema':'pdf-receipt-rules/0.1','file_sha256':manifest['file_sha256'],'page_count':manifest['page_count'],
      'preparation_status':manifest['status'],'pages':results,'overall_authenticity':None,'business_validated':False,
      'execution':'succeeded' if bound['status']=='succeeded' and all(p['rules_status']=='succeeded' for p in results) else 'partial',
      'coverage':{'executed_checks':sum(len((p.get('result') or {}).get('content',{}).get('checks',[])) for p in results),
        'pages_without_applicable_checks':[p['page'] for p in results if not (p.get('result') or {}).get('content',{}).get('checks')]},
      'scope':'same_three_research_receipt_layouts_not_all_financial_documents'}

def main():
    p=argparse.ArgumentParser();p.add_argument('--prepared-dir',type=Path,required=True);a=p.parse_args();d=a.prepared_dir
    r=fuse_pdf_pages(json.loads((d/'pages/manifest.json').read_text()),json.loads((d/'ocr.json').read_text()))
    with (d/'receipt-rules.json').open('x') as f:json.dump(r,f,ensure_ascii=False,indent=2)
    print(json.dumps({'execution':r['execution'],'pages':len(r['pages']),'checks':sum(len((p.get('result')or{}).get('content',{}).get('checks',[])) for p in r['pages'])}))
if __name__=='__main__':main()
