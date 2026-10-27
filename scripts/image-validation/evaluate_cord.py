"""Spatially anchored word retrievability on CORD annotations, not semantic extraction accuracy."""
import argparse,json,re,unicodedata
from collections import defaultdict
from pathlib import Path
from smoke_ocr import sha256
from evaluate_results import wilson

def normalize(text):return re.sub(r'\s+','',unicodedata.normalize('NFC',text))
def bbox(poly):return [min(p[0] for p in poly),min(p[1] for p in poly),max(p[0] for p in poly),max(p[1] for p in poly)]
def overlap(gt,region):
    a=bbox(gt);b=bbox(region);area=(a[2]-a[0])*(a[3]-a[1])
    return max(0,min(a[2],b[2])-max(a[0],b[0]))*max(0,min(a[3],b[3])-max(a[1],b[1]))/area if area>0 else 0

def contains_word(expected,observed,legacy=False):
    # Retain word separators while checking boundaries. Removing them first
    # incorrectly rejects both words in a correct merged OCR line.
    norm = normalize if legacy else lambda t: re.sub(r'\s+', ' ', unicodedata.normalize('NFC',t)).strip()
    target=norm(expected);text=norm(observed)
    if not target:return False
    for m in re.finditer(re.escape(target),text):
        left=m.start()==0 or not(target[0].isalnum() and text[m.start()-1].isalnum())
        right=m.end()==len(text) or not(target[-1].isalnum() and text[m.end()].isalnum())
        if not legacy and re.fullmatch(r'[+-]?\d+(?:[.,]\d+)*', target):
            # Do not retrieve positive 60 from -60 or 1 from 1.00.
            left = left and (m.start()==0 or text[m.start()-1] not in '+-.,')
            right = right and (m.end()==len(text) or text[m.end()] not in '.,')
        if left and right:return True
    return False

def evaluate(annotations,samples,legacy=False):
    groups=defaultdict(lambda:dict(words=0,located=0,retrieved=0));details=[]
    for entry in annotations:
        sample=samples.get(entry['sample_id'],{});regions=sample.get('regions',[]) if sample.get('status')=='succeeded' else []
        for line in entry['annotation']['valid_line']:
            for word in line['words']:
                if not normalize(word['text']):continue
                q=word['quad'];poly=[[q[f'x{i}'],q[f'y{i}']] for i in range(1,5)]
                candidates=[r for r in regions if overlap(poly,r['polygon'])>=.5]
                good=[r for r in candidates if contains_word(word['text'],r['observed_text'],legacy)]
                categories=['all',line['category']]
                if word.get('is_key') == 0:categories += ['all_value_words',line['category']+':value']
                for category in categories:
                    g=groups[category];g['words']+=1;g['located']+=bool(candidates);g['retrieved']+=bool(good)
                if not good:details.append({'sample_id':entry['sample_id'],'category':line['category'],'expected':word['text'],'annotation_is_key':word.get('is_key'),'candidate_texts':[r['observed_text'] for r in candidates],'reason':'text_not_retrievable' if candidates else 'no_spatial_match'})
    for g in groups.values():
        g['retrievability']=g['retrieved']/g['words'];g['spatial_coverage']=g['located']/g['words']
        # Words in the same document are correlated; no binomial word CI claim.
    return {'groups':dict(groups),'misses':details}

def main():
    p=argparse.ArgumentParser();p.add_argument('--directory',type=Path,required=True);a=p.parse_args();d=a.directory
    manifest=json.loads((d/'manifest.json').read_text());run=json.loads((d/'ocr-results.json').read_text());gt=json.loads((d/'ground-truth.json').read_text())
    if run['manifest_sha256']!=sha256(d/'manifest.json'):raise ValueError('Manifest changed')
    rows={s['sample_id']:s for s in run['samples']}
    if len(rows)!=len(run['samples']) or set(rows)-{m['sample_id'] for m in manifest}:raise ValueError('Duplicate/unexpected result')
    for m in manifest:
        if m['sample_id'] in rows and rows[m['sample_id']].get('input_sha256')!=m['expected_sha256']:raise ValueError('Input hash mismatch')
    result=evaluate(gt,rows)
    result['metric_version']='cord-word-retrieval/0.2'
    result['legacy_v01_groups']=evaluate(gt,rows,legacy=True)['groups']
    result['protocol_amendment']={'kind':'evaluation_bug_fix_after_partial_output_inspection',
        'reason':'Removing whitespace before boundary checks falsely missed -TICKET and CP in correct -TICKET CP OCR text',
        'normalization':'NFC_and_collapsed_whitespace_with_word_boundaries_preserved_case_and_punctuation_unchanged',
        'changed_model_or_samples':False,'legacy_results_retained':True,'numeric_boundaries':'preserve_sign_and_decimal_or_grouping_separators'}
    result['execution']=run.get('execution')
    result['latency_scope']=run.get('latency_scope')
    times=sorted(s['seconds'] for s in rows.values())
    result.update(n=len(manifest),completed=len(rows),succeeded=sum(s['status']=='succeeded' for s in rows.values()),complete=len(rows)==len(manifest),protocol=json.loads((d/'protocol.json').read_text()),latency_seconds={'median':times[len(times)//2],'max':max(times)} if times else None)
    (d/'metrics.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k in ('n','completed','succeeded','complete','metric_version','latency_scope')},ensure_ascii=False));print(json.dumps(result['groups']['all']))
if __name__=='__main__':main()
