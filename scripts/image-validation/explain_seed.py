"""Send at most three explicitly selected redacted summaries; never image/OCR text."""
import argparse,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'src/modules/image/documents/python'))
from deepseek_explainer import make_summary,read_settings,explain,ExplanationError
from review_explanation import ExplanationBudget

def main():
    p=argparse.ArgumentParser();p.add_argument('--results',type=Path,required=True);p.add_argument('--sample-id',action='append',required=True);p.add_argument('--config',type=Path,default=Path('.env.image-documents.local'));p.add_argument('--output',type=Path,required=True);p.add_argument('--send',action='store_true');p.add_argument('--ocr-report',type=Path,action='append',default=[]);a=p.parse_args()
    if not 1<=len(a.sample_id)<=3 or len(set(a.sample_id))!=len(a.sample_id):raise ValueError('Select one to three distinct sample IDs')
    if a.output.exists():raise FileExistsError('Preserve previous explanation run')
    rows=json.loads(a.results.read_text())['samples'];byid={s['sample_id']:s for s in rows}
    # A dry run never opens credentials. A run's output-adjacent budget survives retries.
    settings=read_settings(a.config) if a.send else {};reports=[]
    budget=ExplanationBudget(a.output.parent/(a.output.stem+'-budget'),max_calls=len(a.sample_id) if a.send else 0)
    ocrs={}
    for path in a.ocr_report:
        for row in json.loads(path.read_text())['samples']:
            ocrs[row['input_sha256']]=row
    prompt=Path(__file__).resolve().parents[2]/'src/modules/image/documents/prompts/deepseek-target-review-v1.txt'
    for sid in a.sample_id:
        ocr=ocrs.get(byid[sid]['input_sha256']);checks=[]
        if ocr and ocr.get('status')=='succeeded':
            from receipt_evidence import receipt_rules
            checks=receipt_rules(ocr)['checks']
        summary=make_summary(byid[sid],ocr,checks);r={'sample_id':sid,'detector_sample_sha256':__import__('hashlib').sha256(json.dumps(byid[sid],sort_keys=True).encode()).hexdigest(),'outbound_summary':summary}
        try:r['api']=budget.run(summary,settings,prompt,enabled=a.send)
        except ExplanationError as e:r['api']={'status':'failed','reason':str(e)}
        reports.append(r)
    a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps({'detector_report_sha256':__import__('hashlib').sha256(a.results.read_bytes()).hexdigest(),'samples':reports},ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'statuses':[r['api']['status'] for r in reports],'image_sent':False,'raw_text_sent':False}))
if __name__=='__main__':main()
