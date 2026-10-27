"""Frozen 60 RealText comparison + 100 CORD observational inference; CORD forensic labels unverified."""
import argparse,json,sys,time,os
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'src/modules/image/documents/python'))
from seed_detector import SeedDetector,digest

def main():
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--weights',type=Path,required=True);p.add_argument('--manifest',type=Path,required=True);p.add_argument('--output-dir',type=Path,required=True);p.add_argument('--gpu',default='3');p.add_argument('--input-mode',choices=['native','resize512'],default='native');p.add_argument('--max-pixels',type=int,default=20_000_000);a=p.parse_args()
    a.output_dir.mkdir(parents=True,exist_ok=True)
    dest=a.output_dir/'results.json'
    if dest.exists():raise FileExistsError('Keep original experiment')
    model=SeedDetector(a.source,a.weights,a.gpu)
    from PIL import Image,ImageOps,ImageDraw
    import numpy as np,torch,transformers
    report={'provider':'SEED','manifest_sha256':digest(a.manifest),'load':model.load_record,'versions':{'torch':torch.__version__,'transformers':transformers.__version__},'input_mode':a.input_mode,'max_pixels':a.max_pixels,'threshold':.5,'patch_gate':.5,'mask_threshold':.5,'physical_gpu':a.gpu,'samples':[],'score_semantics':'uncalibrated_max_native_tile_forgery_score','source_revision':__import__('seed_detector').SOURCE_REVISION,'weights_sha256':__import__('seed_detector').WEIGHTS_SHA256}
    for i,row in enumerate(json.loads(a.manifest.read_text())):
        sample=dict(row,status='failed');start=time.perf_counter()
        try:
            path=Path(row['path']);sample['input_sha256']=digest(path)
            if sample['input_sha256']!=row['expected_sha256']:raise ValueError('Frozen sample changed')
            with Image.open(path) as img:
                sample['exif_orientation']=img.getexif().get(274,1);image=ImageOps.exif_transpose(img).convert('RGB')
            sample['oriented_size']=list(image.size)
            if a.input_mode=='native':
                values,prob,mask=model.predict(image,max_pixels=a.max_pixels)
            else:
                import cv2
                from seed_detector import components
                resized=Image.fromarray(cv2.resize(np.asarray(image),(512,512),interpolation=cv2.INTER_LINEAR))
                values,small_prob,_=model.predict(resized,max_pixels=a.max_pixels)
                prob=cv2.resize(small_prob,image.size,interpolation=cv2.INTER_LINEAR)
                mask,regions=components(prob);values.update(regions=regions,region_count=len(regions),pixel_fraction=float(mask.mean()))
                values['input_transform']={'type':'resize512','source_size':list(image.size),'model_size':[512,512]}
            sample.update(values)
            stem=f'{i:03d}';Image.fromarray((prob*65535).round().astype(np.uint16)).save(a.output_dir/f'{stem}-prob.png')
            Image.fromarray(mask*255).save(a.output_dir/f'{stem}-mask.png')
            overlay=np.asarray(image).copy();active=mask.astype(bool);overlay[active]=(overlay[active]*.55+np.array([255,0,0])*.45).astype(np.uint8)
            preview=Image.fromarray(overlay);draw=ImageDraw.Draw(preview)
            for region in sample['regions'][:200]:draw.rectangle(region['box'],outline='red',width=2)
            preview.thumbnail((900,1200));preview.save(a.output_dir/f'{stem}-overlay.jpg')
            sample.update(status='succeeded',mask_file=f'{stem}-mask.png',probability_file=f'{stem}-prob.png',overlay_file=f'{stem}-overlay.jpg',visualization_box_limit=200,all_regions_saved=True)
        except Exception as e:sample.update(error_type=type(e).__name__,error=str(e)[:400])
        sample['seconds']=time.perf_counter()-start;report['samples'].append(sample)
        tmp=dest.with_suffix('.tmp');tmp.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');tmp.replace(dest)
        print(json.dumps({'n':i+1,'status':sample['status'],'score':sample.get('detector_score'),'regions':sample.get('region_count'),'seconds':round(sample['seconds'],3)}),flush=True)
    return int(any(s['status']!='succeeded' for s in report['samples']))
if __name__=='__main__':raise SystemExit(main())
