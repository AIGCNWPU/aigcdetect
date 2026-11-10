"""Score a fixture list with the serving TruFor adapter (no tuning).
Optionally computes pixel IoU when a ground-truth mask is supplied."""
import argparse,json,sys,time
from pathlib import Path
import numpy as np
from PIL import Image,ImageOps
p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--fixtures',required=True);p.add_argument('--device',default='cuda:2');p.add_argument('--output',required=True);a=p.parse_args()
root=Path(a.root);out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'src/modules/image/general'))
from tamper import TamperEngine
import torch
torch.set_num_threads(4)
if a.device.startswith('cuda'):torch.cuda.set_per_process_memory_fraction(.20,torch.device(a.device))
fixtures=json.loads(Path(a.fixtures).read_text())
engine=TamperEngine(root,a.device);rows=[]
for item in fixtures:
    with Image.open(item['imagePath']) as im: rgb=ImageOps.exif_transpose(im).convert('RGB')
    started=time.monotonic();score,anomaly,conf,processed=engine.predict(rgb)
    row={'id':item['id'],'tier':item.get('tier'),'score':float(score),'seconds':time.monotonic()-started,'size':list(rgb.size),'detected':bool(score>.5)}
    if item.get('maskPath'):
        with Image.open(item['maskPath']) as mi: mask=np.asarray(mi.convert('L').resize(processed.size,Image.Resampling.NEAREST))>10
        for th in (0.5,0.3,0.15):
            pred=anomaly>th;tp=int((pred&mask).sum());fp=int((pred&~mask).sum());fn=int((~pred&mask).sum())
            row[f'iou@{th}']=tp/max(1,tp+fp+fn);row[f'f1@{th}']=2*tp/max(1,2*tp+fp+fn)
    rows.append(row);print(json.dumps(row,ensure_ascii=False),flush=True)
(out/'predictions.json').write_text(json.dumps(rows,indent=2,ensure_ascii=False))
summary={'detected@0.5':int(sum(r['detected'] for r in rows)),'total':len(rows),'meanScore':float(np.mean([r['score'] for r in rows])),'weightsSha256':engine.digest}
(out/'summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary))
