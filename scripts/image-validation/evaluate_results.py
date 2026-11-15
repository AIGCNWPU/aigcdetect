"""Summarize frozen inference runs with failure coverage and explicit label limits."""
import argparse
import itertools
import json
import math
import re
from pathlib import Path


def wilson(successes, total):
    if not total:
        return None
    z = 1.959963984540054
    p = successes / total
    denominator = 1 + z*z/total
    center = (p + z*z/(2*total)) / denominator
    half = z * math.sqrt(p*(1-p)/total + z*z/(4*total*total)) / denominator
    return [max(0, center-half), min(1, center+half)]


def ranking_metrics(labels, scores):
    positive = [s for y,s in zip(labels,scores) if y == 1]
    negative = [s for y,s in zip(labels,scores) if y == 0]
    if not positive or not negative:
        return {'roc_auc': None, 'average_precision': None}
    auc = sum((p>n) + .5*(p==n) for p in positive for n in negative)/(len(positive)*len(negative))
    seen = hits = 0
    ap = 0
    for _, group in itertools.groupby(sorted(zip(scores,labels),reverse=True),key=lambda x:x[0]):
        rows = list(group)
        new_hits = sum(y for _,y in rows)
        seen += len(rows); hits += new_hits
        ap += new_hits/len(positive) * hits/seen
    return {'roc_auc':auc, 'average_precision':ap}


def prediction(sample, kind):
    if sample.get('status') != 'succeeded' or sample.get('token_limit_reached'):
        return None
    if kind == 'mirror':
        score = sample.get('generated_score')
        return int(score >= .5) if isinstance(score,(float,int)) and math.isfinite(score) and 0<=score<=1 else None
    text = sample.get('raw_output','').replace('**','')
    labels = re.findall(r'\[Conclusion\]\s*:\s*(AUTHENTIC|FORGED)\b',text,re.I)
    return int(labels[0].upper()=='FORGED') if len(labels)==1 else None


def summarize(samples, kind):
    pairs = [(s,prediction(s,kind)) for s in samples]
    valid = [(s,p) for s,p in pairs if p is not None]
    tn=sum(s['label']==0 and p==0 for s,p in valid)
    fp=sum(s['label']==0 and p==1 for s,p in valid)
    fn=sum(s['label']==1 and p==0 for s,p in valid)
    tp=sum(s['label']==1 and p==1 for s,p in valid)
    def ratio(a,n):return a/n if n else None
    result={'n':len(samples),'valid_predictions':len(valid),'failed_or_unparsed':len(samples)-len(valid),
      'truncated':sum(bool(s.get('token_limit_reached')) for s in samples),
      'confusion':{'tn':tn,'fp':fp,'fn':fn,'tp':tp},'accuracy_on_valid':ratio(tp+tn,len(valid)),
      'correct_fraction_of_all_inputs':ratio(tp+tn,len(samples)),
      'fpr':ratio(fp,fp+tn),'fnr':ratio(fn,fn+tp),'recall':ratio(tp,tp+fn),
      'fpr_wilson95':wilson(fp,fp+tn),'recall_wilson95':wilson(tp,tp+fn),
      'all_positive_inputs':sum(s['label']==1 for s in samples),
      'all_negative_inputs':sum(s['label']==0 for s in samples),
      'positive_detection_yield_all_inputs':ratio(tp,sum(s['label']==1 for s in samples)),
      'unavailable_by_label':{str(label):sum(s['label']==label and prediction(s,kind) is None for s in samples) for label in (0,1)}}
    times=sorted(s['seconds'] for s in samples if isinstance(s.get('seconds'),(int,float)))
    if times: result['latency_seconds']={'median':times[len(times)//2],'p95':times[math.ceil(.95*len(times))-1],'max':times[-1]}
    if kind=='mirror':result.update(ranking_metrics([s['label'] for s,_ in valid],[s['generated_score'] for s,_ in valid]))
    else:
        boxes=invalid=0
        for s in samples:
            for match in re.findall(r'\[GROUNDING\]\s*:\s*(\[[^\]]+\])',s.get('raw_output','')):
                boxes+=1
                try:
                    box=json.loads(match); w,h=s['oriented_size']
                    if (len(box)!=4 or any(type(x) not in (float,int) or not math.isfinite(x) for x in box)
                        or not (0<=box[0]<box[2]<=w and 0<=box[1]<box[3]<=h)):invalid+=1
                except (ValueError,TypeError,KeyError):invalid+=1
        result['raw_coordinate_audit']={'boxes':boxes,'invalid_if_original_pixels':invalid,
           'coordinate_space_calibrated':False,'iou':None,'reason':'missing_reference_masks_and_unverified_model_coordinate_space'}
    return result


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--results',type=Path,required=True)
    p.add_argument('--manifest',type=Path,required=True)
    p.add_argument('--kind',choices=['mirror','docshield'],required=True)
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args()
    from smoke_ocr import sha256
    run=json.loads(a.results.read_text(encoding='utf-8'))
    if run['manifest_sha256'] != sha256(a.manifest): raise ValueError('Inference manifest differs from frozen manifest')
    manifest=json.loads(a.manifest.read_text(encoding='utf-8'))
    rows={s['sample_id']:s for s in run['samples']}
    if len(rows)!=len(run['samples']):raise ValueError('Duplicate inference result')
    samples=[]
    for m in manifest:
        row=rows.get(m['sample_id'],dict(m,status='not_run'))
        if row.get('label')!=m['label'] or row.get('input_sha256',m['expected_sha256'])!=m['expected_sha256']:raise ValueError('Label/source mismatch')
        samples.append(row)
    if set(rows)-{m['sample_id'] for m in manifest}:raise ValueError('Unexpected inference sample')
    report={'threshold':.5 if a.kind=='mirror' else None,'kind':a.kind,'frozen_manifest_sha256':sha256(a.manifest),
            'complete':len(rows)==len(manifest),'independent_generalization_established':False,
            'limitations':['local_directory_labels_and_unknown_training_overlap'] if a.kind=='mirror' else ['training_related_dataset','no_pixel_masks','not_OCR_ground_truth'],
            'overall':summarize(samples,a.kind),
            'groups':{name:summarize([s for s in samples if s['dataset']==name],a.kind) for name in sorted({s['dataset'] for s in samples})}}
    a.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report['overall'],ensure_ascii=False))


if __name__=='__main__':main()
