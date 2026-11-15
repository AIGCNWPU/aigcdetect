"""Audit RPA attribution on untouched DDA-COCO FLUX.1 reconstruction images.

Reports FLUX-family recall only: this single-family set cannot measure overall
attribution accuracy or validate an ensemble/unknown-rejection policy.
"""
import argparse
from collections import Counter
import hashlib
import io
import json
from pathlib import Path
import sys
import time


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root', type=Path, required=True)
    p.add_argument('--dataset', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--device', default='cpu')
    p.add_argument('--limit', type=int, default=0, help='0 means every FLUX image')
    args = p.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]/'src/modules/image/general'))
    import torch
    import numpy as np
    from PIL import Image
    from forensics import SourceEngine
    torch.set_num_threads(4)
    if args.device.startswith('cuda'):
        torch.cuda.set_per_process_memory_fraction(.1, torch.device(args.device))
    paths = sorted((args.dataset/'FLUX.1/val2017').glob('*.jpg'))
    if args.limit:
        paths = paths[:args.limit]
    if not paths:
        raise ValueError('No FLUX.1 JPEG files found')
    all_results = {}
    for checkpoint in ['openfake_27class.pt','dragon_25class.pt']:
        engine = SourceEngine(args.root.resolve(), args.device, checkpoint)
        rows = []
        start = time.monotonic()
        for path in paths:
            try:
                with Image.open(path) as image:
                    rgb = image.convert('RGB')
                    encoding = image.format
                result = engine.score(rgb)
                rows.append({'file':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
                    'encoding':encoding,'size':list(rgb.size),'status':result['status'],
                    'candidates':result.get('candidates',[])})
            except Exception as error:
                rows.append({'file':path.name,'status':'failed','error':type(error).__name__})
            if len(rows) % 250 == 0:
                print(checkpoint,len(rows),'/',len(paths),flush=True)
                (args.output/(checkpoint+'.progress.json')).write_text(json.dumps({'processed':len(rows),'total':len(paths)}))
        valid = [r for r in rows if r.get('candidates')]
        summary = {'checkpoint':checkpoint,'weightsSha256':engine.digest,
            'dataset':'DDA-COCO/FLUX.1/val2017','inputPath':str(args.dataset.resolve()),
            'total':len(paths),'completed':len(valid),'failed':len(rows)-len(valid),
            'fluxFamilyTop1Count':sum(r['candidates'][0]['source'].lower().startswith('flux') for r in valid),
            'fluxFamilyInTop3Count':sum(any(c['source'].lower().startswith('flux') for c in r['candidates']) for r in valid),
            'fluxFamilyTop1Recall':sum(r['candidates'][0]['source'].lower().startswith('flux') for r in valid)/len(valid),
            'fluxFamilyInTop3Recall':sum(any(c['source'].lower().startswith('flux') for c in r['candidates']) for r in valid)/len(valid),
            'top1Counts':dict(Counter(r['candidates'][0]['source'] for r in valid)),
            'wrongFamilyWithTopScoreAbove0_95':sum(not r['candidates'][0]['source'].lower().startswith('flux') and r['candidates'][0]['score']>.95 for r in valid),
            'seconds':time.monotonic()-start,'device':args.device,
            'preprocess':'Original decoded RGB; checkpoint normalization; no resizing or re-encoding',
            'scope':'Single-family reconstruction set: family recall, not full multiclass accuracy. Exact FLUX variant is not established by the folder label.'}
        key=checkpoint.removesuffix('.pt')
        (args.output/(key+'-predictions.json')).write_text(json.dumps(rows,indent=2)+'\n')
        (args.output/(key+'-summary.json')).write_text(json.dumps(summary,indent=2)+'\n')
        all_results[key]=summary
        print(json.dumps(summary),flush=True)
        del engine
        if args.device.startswith('cuda'):
            torch.cuda.empty_cache()
    # Lossless PNG conversion cannot restore traces already absent from RGB.
    with Image.open(paths[0]) as image:
        rgb=image.convert('RGB');buffer=io.BytesIO();rgb.save(buffer,format='PNG');buffer.seek(0)
        with Image.open(buffer) as restored:
            identical=bool(np.array_equal(np.array(rgb),np.array(restored)))
    (args.output/'summary.json').write_text(json.dumps({'evaluations':all_results,
        'losslessPngRgbIdentical':identical,'sample':paths[0].name},indent=2)+'\n')


if __name__ == '__main__':
    main()
