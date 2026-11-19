"""Evaluate the exact serving adapter on official CocoGlide pairs, no tuning."""
import argparse,json,sys,time
from pathlib import Path
import numpy as np
from PIL import Image,ImageOps
p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--device',default='cuda:3');p.add_argument('--output',required=True);a=p.parse_args()
root=Path(a.root);out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'src/modules/image/general'))
from tamper import TamperEngine
import torch
from sklearn.metrics import roc_auc_score,accuracy_score,confusion_matrix

torch.set_num_threads(4)
if a.device.startswith('cuda'):torch.cuda.set_per_process_memory_fraction(.20,torch.device(a.device))
start=time.monotonic();engine=TamperEngine(root,a.device);load=time.monotonic()-start
manifest=json.loads((root/'datasets/provenance-20261105/cocoglide/manifest.json').read_text())
masks={r['id']:r['path'] for r in manifest if r['kind']=='mask'};rows=[]
for r in manifest:
 if r['kind']=='mask':continue
 started=time.monotonic()
 with Image.open(r['path']) as im:rgb=ImageOps.exif_transpose(im).convert('RGB')
 score,anomaly,conf,processed=engine.predict(rgb)
 row={'id':r['id'],'path':r['path'],'label':int(r['kind']=='fake'),'score':score,'seconds':time.monotonic()-started,'originalSize':list(rgb.size),'inferenceSize':list(processed.size)}
 if row['label']:
  with Image.open(masks[r['id']]) as im:mask=np.asarray(im.convert('L').resize(processed.size,Image.Resampling.NEAREST))>127
  pred=anomaly>.5;tp=int((pred&mask).sum());fp=int((pred&~mask).sum());fn=int((~pred&mask).sum())
  row.update(pixelF1=2*tp/max(1,2*tp+fp+fn),pixelIoU=tp/max(1,tp+fp+fn),maskForeground=int(mask.sum()))
 np.savez_compressed(out/f"{r['kind']}-{r['id']}.npz",anomaly=anomaly,confidence=conf)
 rows.append(row);(out/'predictions.json').write_text(json.dumps(rows,indent=2))
 print(r['kind'],r['id'],round(score,4),flush=True)
y=[r['label'] for r in rows];s=[r['score'] for r in rows]
summary={'dataset':'official CocoGlide seeded 40 pairs','images':len(rows),'threshold':.5,'auc':float(roc_auc_score(y,s)),'accuracy':float(accuracy_score(y,np.array(s)>.5)),'confusionMatrix':confusion_matrix(y,np.array(s)>.5).tolist(),'meanPixelF1':float(np.mean([r['pixelF1'] for r in rows if r['label']])),'meanPixelIoU':float(np.mean([r['pixelIoU'] for r in rows if r['label']])),'localizationProtocol':'fake only; raw anomaly>.5; no inversion; no boundary removal; not identical to paper metric','weightsSha256':engine.digest,'loadSeconds':load,'meanInferenceSeconds':float(np.mean([r['seconds'] for r in rows])),'peakCudaAllocatedMB':torch.cuda.max_memory_allocated(a.device)/1024**2 if a.device.startswith('cuda') else None,'resized':sum(r['inferenceSize']!=r['originalSize'] for r in rows)}
(out/'summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary),flush=True)
