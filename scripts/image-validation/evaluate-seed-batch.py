"""Batch SEED evaluation on a fixture list (serving adapter, no tuning).
Computes tile-max score, detection at .5, and pixel IoU/F1 against a
ground-truth mask at several probability thresholds."""
import argparse,json,sys,time
from pathlib import Path
import numpy as np
from PIL import Image,ImageOps
p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--fixtures',required=True);p.add_argument('--gpu',default='2');p.add_argument('--output',required=True);a=p.parse_args()
root=Path(a.root);out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'src/modules/image/documents/python'))
from seed_detector import SeedDetector
fixtures=json.loads(Path(a.fixtures).read_text())
detector=SeedDetector(root/'third_party/seed',root/'weights/seed',gpu=a.gpu)
rows=[]
for item in fixtures:
    with Image.open(item['imagePath']) as im: rgb=ImageOps.exif_transpose(im).convert('RGB')
    started=time.monotonic();result,probability,_mask=detector.predict(rgb)
    score=result['detector_score'];regions=result['regions']
    row={'id':item['id'],'tier':item.get('tier'),'score':float(score),'detected':bool(score>=.5),'regions':len(regions),'seconds':round(time.monotonic()-started,3),'size':list(rgb.size)}
    if item.get('maskPath'):
        with Image.open(item['maskPath']) as mi: gt=np.asarray(mi.convert('L').resize(rgb.size,Image.Resampling.NEAREST))>127
        prob=probability
        for th in (0.5,0.3,0.15):
            pred=prob>=th;tp=int((pred&gt).sum());fp=int((pred&~gt).sum());fn=int((~pred&gt).sum())
            row[f'iou@{th}']=tp/max(1,tp+fp+fn);row[f'f1@{th}']=2*tp/max(1,2*tp+fp+fn)
    rows.append(row);print(json.dumps(row,ensure_ascii=False),flush=True)
(out/'predictions.json').write_text(json.dumps(rows,indent=2,ensure_ascii=False))
detected=[r for r in rows if r['detected']]
summary={'total':len(rows),'detected@0.5':len(detected),'meanScore':float(np.mean([r['score'] for r in rows])),
 'meanIoU@0.5(detected)':float(np.mean([r.get('iou@0.5',0) for r in detected])) if detected else None,
 'meanIoU@0.5(all)':float(np.mean([r.get('iou@0.5',0) for r in rows]))}
(out/'summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary))
