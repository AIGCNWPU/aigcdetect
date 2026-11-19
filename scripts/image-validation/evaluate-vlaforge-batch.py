"""Score a fixture list with the serving VLAForge face engine (no tuning).
Reports per-face scores, coverage and a per-image decision at threshold .5."""
import argparse,json,sys,time
from pathlib import Path
import numpy as np
from PIL import Image,ImageOps
p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--fixtures',required=True);p.add_argument('--device',default='cuda:2');p.add_argument('--output',required=True);a=p.parse_args()
root=Path(a.root);out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'src/modules/image/general'))
import torch
from forensics import FaceEngine
torch.set_num_threads(4)
if a.device.startswith('cuda'):torch.cuda.set_per_process_memory_fraction(.30,torch.device(a.device))
fixtures=json.loads(Path(a.fixtures).read_text())
engine=FaceEngine(root,a.device);rows=[]
for item in fixtures:
    with Image.open(item['imagePath']) as im: rgb=ImageOps.exif_transpose(im).convert('RGB')
    started=time.monotonic();result=engine.score(rgb)
    result.pop('preview',None)
    faces=result.get('faces') or []
    top=max((f.get('score',0) for f in faces),default=None)
    rows.append({'id':item['id'],'tier':item.get('tier'),'label':item.get('label'),
      'status':result.get('status'),'faces':len(faces),'topScore':top,
      'verdict':'fake' if (top is not None and top>=.5) else ('real' if top is not None else 'no_face'),
      'seconds':round(time.monotonic()-started,3),'imageSize':list(rgb.size)})
    print(json.dumps(rows[-1],ensure_ascii=False),flush=True)
(out/'predictions.json').write_text(json.dumps(rows,indent=2,ensure_ascii=False))
covered=[r for r in rows if r['verdict']!='no_face']
summary={'total':len(rows),'covered':len(covered),'detectedFake':int(sum(1 for r in covered if r['verdict']=='fake')),
  'missedFake':int(sum(1 for r in covered if r['verdict']=='real')),
  'noFace':int(sum(1 for r in rows if r['verdict']=='no_face')),
  'meanTopScore':float(np.mean([r['topScore'] for r in covered])) if covered else None,'weights':'weights/vlaforge/model.pth'}
(out/'summary.json').write_text(json.dumps(summary,indent=2,ensure_ascii=False));print(json.dumps(summary,ensure_ascii=False))
