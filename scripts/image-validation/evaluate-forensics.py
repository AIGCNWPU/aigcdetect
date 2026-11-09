"""Evaluate the downloaded engineering subsets; keep per-image predictions."""
import argparse
from collections import Counter, defaultdict
import json
import io
from pathlib import Path
import sys
import time


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root', type=Path, required=True)
    p.add_argument('--datasets', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--device', default='cpu')
    p.add_argument('--module', choices=['face','source','whole','jpeg'], required=True)
    p.add_argument('--source-dataset', choices=['all','dragon','openfake-local','openfake-original'], default='all')
    args = p.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]/'src/modules/image/general'))
    import torch
    from PIL import Image, ImageOps
    from sklearn.metrics import roc_auc_score, confusion_matrix, f1_score
    from forensics import FaceEngine, SourceEngine
    torch.set_num_threads(4)

    def timed_score(engine, path):
        with Image.open(path) as source:
            rgb = ImageOps.exif_transpose(source).convert('RGB')
        if args.device.startswith('cuda'):
            torch.cuda.synchronize(args.device)
        t = time.monotonic()
        result = engine.score(rgb)
        if args.device.startswith('cuda'):
            torch.cuda.synchronize(args.device)
        result.pop('preview', None)
        return result, time.monotonic()-t

    def save(name, predictions, summary):
        (args.output/(name+'-predictions.json')).write_text(json.dumps(predictions, ensure_ascii=False, indent=2)+'\n')
        (args.output/(name+'-summary.json')).write_text(json.dumps(summary, ensure_ascii=False, indent=2)+'\n')
        print(json.dumps(summary, ensure_ascii=False), flush=True)

    if args.module == 'whole':
        sys.path.insert(0, str(args.root/'third_party/dda_hplus'))
        from dda_hplus import DDAPredictor
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.backends.cudnn.allow_tf32 = False
        torch.backends.cuda.enable_flash_sdp(False)
        torch.backends.cuda.enable_mem_efficient_sdp(False)
        manifest = json.loads((args.datasets/'openfake-original/manifest.json').read_text())
        t = time.monotonic()
        engine = DDAPredictor(args.root/'weights/dda_hplus/dda_hplus_fp32.pth', device=args.device)
        load_seconds = time.monotonic()-t
        t = time.monotonic()
        predictions = engine.predict([r['path'] for r in manifest], batch_size=4)
        if args.device.startswith('cuda'):
            torch.cuda.synchronize(args.device)
        seconds = time.monotonic()-t
        rows = [{**r,'score':v['fake_probability'],'predicted':int(v['is_fake'])}
                for r,v in zip(manifest,predictions)]
        labels = [r['label'] for r in rows]
        save('whole-image', rows, {'model':'DDA H+ official FP32',
            'dataset':'OpenFake v1 official test first row group','samples':len(rows),
            'real':sum(v==0 for v in labels),'fake':sum(v==1 for v in labels),
            'auc':float(roc_auc_score(labels,[r['score'] for r in rows])),
            'accuracyAt0_5':sum(r['predicted']==r['label'] for r in rows)/len(rows),
            'confusion':confusion_matrix(labels,[r['predicted'] for r in rows],labels=[0,1]).tolist(),
            'loadSeconds':load_seconds,'inferenceSeconds':seconds,'device':args.device,
            'scope':'Engineering replay; independence from DDA training data is not established'})
    elif args.module == 'jpeg':
        engine = SourceEngine(args.root.resolve(), args.device)
        manifest = json.loads((args.datasets/'openfake-original/manifest.json').read_text())
        rows, formats = [], Counter()
        for item in manifest:
            if item['source'] not in engine.names:
                continue
            with Image.open(item['path']) as image:
                formats[image.format] += 1
                rgb = image.convert('RGB')
                before = engine.score(rgb)['candidates']
                buffer = io.BytesIO()
                rgb.save(buffer, format='JPEG', quality=95)
                buffer.seek(0)
                after = engine.score(Image.open(buffer).convert('RGB'))['candidates']
            rows.append({'id':item['id'],'source':item['source'],'before':before,'after':after})
        save('rpa-jpeg', rows, {'samples':len(rows),'originalFormats':dict(formats),
            'originalTop1':sum(r['before'][0]['source']==r['source'] for r in rows)/len(rows),
            'jpegQ95Top1':sum(r['after'][0]['source']==r['source'] for r in rows)/len(rows),
            'method':'Same original known-source images, Pillow JPEG Q95 default chroma subsampling, unchanged dimensions',
            'not_training':True})
    elif args.module == 'face':
        manifest = json.loads((args.datasets/'deepfakeface/manifest.json').read_text())
        t = time.monotonic()
        engine = FaceEngine(args.root.resolve(), args.device)
        load_seconds = time.monotonic()-t
        rows = []
        for item in manifest:
            try:
                result, seconds = timed_score(engine, item['path'])
                values = result.get('faces', [])
                row = {**item, 'status':result['status'], 'faces':values,
                       'score':max((f['score'] for f in values), default=None), 'seconds':seconds}
            except Exception as error:
                row = {**item, 'status':'failed','error':type(error).__name__}
            rows.append(row)
            if len(rows) % 10 == 0:
                print('face',len(rows),'/',len(manifest),flush=True)
        scored = [r for r in rows if r['score'] is not None] if all('score' in r for r in rows) else [r for r in rows if r.get('score') is not None]
        labels, scores = [r['label'] for r in scored], [r['score'] for r in scored]
        by_group = {}
        for name in sorted({r['manipulation'] for r in rows}):
            selected = [r for r in rows if r['manipulation']==name]
            valid = [r for r in selected if r.get('score') is not None]
            by_group[name] = {'total':len(selected),'scored':len(valid),
                'correctAt0_5':sum((r['score']>.5)==bool(r['label']) for r in valid),
                'accuracyOnScored':sum((r['score']>.5)==bool(r['label']) for r in valid)/len(valid) if valid else None}
        save('face', rows, {'model':'VLAForge','dataset':'DeepFakeFace 40 paired real/swap/inpaint groups',
            'samples':len(rows),'scored':len(scored),'coverage':len(scored)/len(rows),
            'aucOnScored':float(roc_auc_score(labels,scores)) if len(set(labels))==2 else None,
            'accuracyOnScoredAt0_5':sum((r['score']>.5)==bool(r['label']) for r in scored)/len(scored) if scored else None,
            'confusionOnScored':confusion_matrix(labels,[v>.5 for v in scores],labels=[0,1]).tolist(),
            'groups':by_group,'loadSeconds':load_seconds,'device':args.device,
            'meanScoreSeconds':sum(r['seconds'] for r in scored)/len(scored) if scored else None,
            'scope':'Small paired engineering subset. No pixel masks; this is not pixel localization evaluation.'})
    else:
        for name, checkpoint in [('dragon','dragon_25class.pt'),('openfake-local','openfake_27class.pt'),('openfake-original','openfake_27class.pt')]:
            if args.source_dataset not in {'all',name}:
                continue
            if not (args.datasets/name/'manifest.json').exists():
                continue
            manifest = json.loads((args.datasets/name/'manifest.json').read_text())
            t = time.monotonic()
            engine = SourceEngine(args.root.resolve(), args.device, checkpoint)
            load_seconds = time.monotonic()-t
            rows = []
            for item in manifest:
                try:
                    result, seconds = timed_score(engine, item['path'])
                    candidates = result.get('candidates', [])
                    row = {**item,'status':result['status'],'candidates':candidates,'seconds':seconds,
                           'knownSource':item['source'] in engine.names}
                except Exception as error:
                    row = {**item,'status':'failed','error':type(error).__name__,'knownSource':item['source'] in engine.names}
                rows.append(row)
                if len(rows) % 25 == 0:
                    print(name,len(rows),'/',len(manifest),flush=True)
            known = [r for r in rows if r['knownSource'] and r.get('candidates')]
            unknown = [r for r in rows if not r['knownSource'] and r.get('candidates')]
            labels = [r['source'] for r in known]
            predicted = [r['candidates'][0]['source'] for r in known]
            per_class = defaultdict(list)
            for r in known:
                per_class[r['source']].append(r['candidates'][0]['source']==r['source'])
            save(name, rows, {'model':'RPA '+checkpoint,'weightsSha256':engine.digest,
                'samples':len(rows),'completed':sum(r['status']=='completed' for r in rows),
                'knownScored':len(known),'unknownScored':len(unknown),
                'realScored':sum(r['label']==0 for r in unknown),
                'unsupportedSyntheticScored':sum(r['label']==1 for r in unknown),
                'knownTop1':sum(a==b for a,b in zip(labels,predicted))/len(known) if known else None,
                'knownTop3':sum(r['source'] in [c['source'] for c in r['candidates']] for r in known)/len(known) if known else None,
                'knownMacroF1':float(f1_score(labels,predicted,labels=sorted(set(labels)),average='macro',zero_division=0)) if known else None,
                'perClassAccuracy':{k:sum(v)/len(v) for k,v in per_class.items()},
                'unknownTopScoreAbove0_95':sum(r['candidates'][0]['score']>.95 for r in unknown),
                'loadSeconds':load_seconds,'device':args.device,
                'meanScoreSeconds':sum(r['seconds'] for r in rows if 'seconds' in r)/sum('seconds' in r for r in rows),
                'scope':'Engineering subset; no unknown rejection or attribution-probability calibration is claimed.'})


if __name__ == '__main__':
    main()
