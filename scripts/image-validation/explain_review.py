"""Explain up to three selected pages from a local workbench run. Dry run by default."""
import argparse
import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'src/modules/image/documents/python'))
from deepseek_explainer import make_summary, read_settings
from review_explanation import ExplanationBudget, make_target_summary


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--review-dir',type=Path,required=True)
    p.add_argument('--sample-id',action='append',required=True)
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--send',action='store_true')
    p.add_argument('--max-calls',type=int,default=0)
    p.add_argument('--config',type=Path,default=Path('.env.image-documents.local'))
    a=p.parse_args()
    if not 1<=len(a.sample_id)<=3 or len(a.sample_id)!=len(set(a.sample_id)):
        p.error('Select one to three distinct sample IDs')
    if a.send and not 1<=a.max_calls<=3:p.error('--send requires explicit --max-calls 1..3')
    if a.output.exists():raise FileExistsError('Preserve previous debug output')
    pages={r['sample_id']:r for r in json.loads((a.review_dir/'pages.json').read_text())}
    seed={r['sample_id']:r for r in json.loads((a.review_dir/'seed/results.json').read_text())['samples']}
    ocr={r['sample_id']:r for r in json.loads((a.review_dir/'ocr/ocr.json').read_text())['samples']}
    review=json.loads((a.review_dir/'result.json').read_text())['review']
    settings=read_settings(a.config) if a.send else {}
    budget=ExplanationBudget(a.review_dir/'explanation-budget',max_calls=a.max_calls)
    prompt=Path(__file__).resolve().parents[2]/'src/modules/image/documents/prompts/deepseek-target-review-v1.txt'
    result=[]
    for sid in a.sample_id:
        row=pages[sid];detector=seed[sid]
        if detector.get('input_sha256')!=row['expected_sha256']:raise ValueError('Detector source mismatch')
        checks=[c for c in review['checks']+review['candidates'] if c.get('materialId')==row['material_id'] or any(e.get('materialId')==row['material_id'] for e in c.get('evidence',[]))]
        summary=make_target_summary(detector,ocr.get(sid),checks,material_id=row['material_id'],page=row['page'])
        result.append({'sample_id':sid,'summary':summary,'explanation':budget.run(summary,settings,prompt,enabled=a.send)})
    a.output.parent.mkdir(parents=True,exist_ok=True)
    with a.output.open('x') as f:json.dump({'samples':result,'image_sent':False,'raw_text_sent':False},f,ensure_ascii=False,indent=2)
    a.output.chmod(0o600)
    print(json.dumps({'statuses':[r['explanation']['status'] for r in result],'api_calls':sum(r['explanation']['api_called'] for r in result)}))


if __name__=='__main__':main()
