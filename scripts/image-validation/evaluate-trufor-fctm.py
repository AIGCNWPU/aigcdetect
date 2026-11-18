"""Run the serving TruFor adapter on the four FCTM fakes used for the market API
comparison, computing pixel IoU/F1 against the dataset masks. No tuning."""
import argparse,json,sys,time
from pathlib import Path
import numpy as np
from PIL import Image,ImageOps
p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--device',default='cuda:3');p.add_argument('--output',required=True);a=p.parse_args()
root=Path(a.root);out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'src/modules/image/general'))
from tamper import TamperEngine
import torch
torch.set_num_threads(4)
if a.device.startswith('cuda'):torch.cuda.set_per_process_memory_fraction(.20,torch.device(a.device))
fake_dir=root/'datasets/documents/FCTM-samples/fakeDocumentImage'
gt_dir=root/'datasets/documents/FCTM-samples/grounTruths'
names=sorted(x.name for x in fake_dir.iterdir() if x.suffix.lower()=='.png')[:4]
engine=TamperEngine(root,a.device);rows=[]
for name in names:
    with Image.open(fake_dir/name) as im: rgb=ImageOps.exif_transpose(im).convert('RGB')
    started=time.monotonic();score,anomaly,conf,processed=engine.predict(rgb)
    with Image.open(gt_dir/name) as im: mask=np.asarray(im.convert('L').resize(processed.size,Image.Resampling.NEAREST))>10
    for th in (0.5,0.3,0.15):
        pred=anomaly>th;tp=int((pred&mask).sum());fp=int((pred&~mask).sum());fn=int((~pred&mask).sum())
        rows.append({'id':name,'threshold':th,'score':float(score),'seconds':time.monotonic()-started,'pixelF1':2*tp/max(1,2*tp+fp+fn),'pixelIoU':tp/max(1,tp+fp+fn),'predRatio':float(pred.mean()),'maskRatio':float(mask.mean())})
    np.savez_compressed(out/f'{name}.npz',anomaly=anomaly,confidence=conf)
summary={'dataset':'FCTM 4 fake documents (same images as market API test)','weightsSha256':engine.digest,'scores':[{'id':r['id'],'score':r['score']} for r in rows[::3]],'byThreshold':{}}
for th in (0.5,0.3,0.15):
    subset=[r for r in rows if r['threshold']==th]
    summary['byThreshold'][str(th)]={'meanPixelIoU':float(np.mean([r['pixelIoU'] for r in subset])),'meanPixelF1':float(np.mean([r['pixelF1'] for r in subset])),'detected':int(sum(1 for r in subset if r['score']>.5))}
(out/'predictions.json').write_text(json.dumps(rows,indent=2,ensure_ascii=False))
(out/'summary.json').write_text(json.dumps(summary,indent=2,ensure_ascii=False))
print(json.dumps(summary,ensure_ascii=False))
