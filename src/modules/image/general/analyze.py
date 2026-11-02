"""DDA H+ classification and reproducible local diagnostics; no external calls."""
import argparse,base64,hashlib,io,json,os,sys,time,warnings,subprocess
from pathlib import Path
import numpy as np
from PIL import Image,ImageFilter,ImageChops,ImageFile
Image.MAX_IMAGE_PIXELS=40000000
ImageFile.LOAD_TRUNCATED_IMAGES=False
warnings.simplefilter('error',Image.DecompressionBombWarning)

def png(im):
 b=io.BytesIO();im.save(b,format='PNG');return 'data:image/png;base64,'+base64.b64encode(b.getvalue()).decode()
def provenance(path):
 root=Path(os.environ.get('AIGC_PLATFORM_ROOT',Path(__file__).resolve().parents[6]))
 tool=root/'runtime/tools/c2pa-cli';lib=tool/'glibc/usr/lib/x86_64-linux-gnu'
 try:
  command=[str(lib/'ld-linux-x86-64.so.2'),'--library-path',str(lib),str(tool/'c2patool/c2patool'),str(path),'--settings',str(tool/'offline.json')]
  run=subprocess.run(command,capture_output=True,text=True,timeout=30)
  if run.returncode:
   message=(run.stderr+run.stdout).lower()
   return {'status':'absent' if 'manifestnotfound' in message or 'no jumbf' in message or 'manifest not found' in message or 'no claim found' in message else 'unverifiable','network':'disabled'}
  r=json.loads(run.stdout);active=r.get('active_manifest');m=r.get('manifests',{}).get(active,{})
  state=r.get('validation_state','Unknown')
  return {'status':str(state).lower(),'activeManifest':active,'signer':m.get('signature_info',{}).get('issuer'),'claimGenerator':m.get('claim_generator'),'actions':[a.get('data',{}) for a in m.get('assertions',[]) if a.get('label','').startswith('c2pa.actions')],'validation':r.get('validation_results',r.get('validation_status',[])),'network':'disabled','validator':'c2patool/0.28.2','trustPolicy':'No custom trust anchors; offline validation'}
 except FileNotFoundError:return {'status':'unavailable','network':'disabled'}
 except Exception as e:return {'status':'unverifiable','errorType':type(e).__name__,'network':'disabled'}

def diagnostics(path,im):
 exif=im.getexif();meta={name:str(exif[tag])[:200] for tag,name in [(271,'相机品牌'),(272,'相机型号'),(305,'处理软件'),(306,'文件记录时间'),(36867,'拍摄记录时间')] if tag in exif}
 # Whitelisted metadata only: do not surface GPS, serial numbers or arbitrary prompt blobs.
 for k in ['Software','software','Author']:
  if isinstance(im.info.get(k),str):meta[k]=im.info[k][:200]
 rgb=im.convert('RGB');rgb.thumbnail((800,800));a=np.asarray(rgb,dtype=np.float32)
 noise=np.abs(a-np.asarray(rgb.filter(ImageFilter.GaussianBlur(1)),dtype=np.float32)).mean(2)
 scale=max(float(np.percentile(noise,99)),1);v=np.clip(noise/scale,0,1)
 color=np.stack([v*235,v*100,80+v*145],2).astype('uint8')
 layers={'original':png(rgb),'residual':png(Image.fromarray(color))};stats={'residualMean':round(float(noise.mean()),3)}
 if im.format=='JPEG':
  buf=io.BytesIO();rgb.save(buf,format='JPEG',quality=90);buf.seek(0)
  diff=np.abs(a-np.asarray(Image.open(buf),dtype=np.float32));layers['compression']=png(Image.fromarray(np.uint8(np.clip(diff*8,0,255))));stats['compressionMean']=round(float(diff.mean()),3)
 gray=np.asarray(rgb.convert('L'),dtype=np.float32);stats['sharpness']=round(float(np.var(gray[1:-1,:-2]+gray[1:-1,2:]+gray[:-2,1:-1]+gray[2:,1:-1]-4*gray[1:-1,1:-1])),2)
 return {'metadata':meta,'dimensions':list(im.size),'format':im.format,'orientation':int(exif.get(274,1)),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'credentials':provenance(path),'layers':layers,'statistics':stats,'compressionApplicable':im.format=='JPEG'}

def main():
 p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--manifest',required=True);p.add_argument('--output',required=True);p.add_argument('--gpu',required=True);p.add_argument('--diagnostics-only',action='store_true');p.add_argument('--classify-only',action='store_true');args=p.parse_args()
 root=Path(args.root);os.environ['AIGC_PLATFORM_ROOT']=str(root);os.environ['CUDA_VISIBLE_DEVICES']=args.gpu;os.environ['HF_HUB_OFFLINE']='1';os.environ['TRANSFORMERS_OFFLINE']='1'
 predictor=None
 if not args.diagnostics_only:
  import torch
  torch.set_num_threads(4);torch.manual_seed(0);torch.backends.cuda.matmul.allow_tf32=False;torch.backends.cudnn.allow_tf32=False;torch.backends.cuda.enable_flash_sdp(False);torch.backends.cuda.enable_mem_efficient_sdp(False)
  sys.path.insert(0,str(root/'third_party/dda_hplus'));from dda_hplus import DDAPredictor
  weights=root/'weights/dda_hplus/dda_hplus_fp32.pth'
  digest=hashlib.file_digest(weights.open('rb'),'sha256').hexdigest() if hasattr(hashlib,'file_digest') else hashlib.sha256(weights.read_bytes()).hexdigest()
  if digest!='f7f8e968cc26b9ad01db99fa985c89c6e5610b1af8d73993eb70490513fc6951':raise ValueError('weights_hash_mismatch')
  predictor=DDAPredictor(weights)
 results=[]
 for row in json.loads(Path(args.manifest).read_text()):
  start=time.monotonic()
  try:
   path=Path(row['path'])
   with Image.open(path) as im:
    im.load()
    if im.format not in ['JPEG','PNG','WEBP']:raise ValueError('unsupported_format')
    if im.width*im.height>40000000:raise ValueError('pixel_limit')
    diag=({'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'dimensions':list(im.size)} if args.classify_only else diagnostics(path,im));rgb=im.convert('RGB');w,h=rgb.size
   result={'id':row['id'],'status':'completed','diagnostics':diag}
   if predictor:
    from torchvision.transforms import functional as F
    crop=F.center_crop(rgb,[336,336]);baseline=predictor.predict([rgb])[0];score=baseline['fake_probability'];crop_score=predictor.predict([crop])[0]['fake_probability']
    if abs(score-crop_score)>1e-5:raise ValueError('crop_parity_failed')
    if args.classify_only:
     result.update(score=score,coverage='中心336×336区域',model={'id':predictor.model_id,'weightsSha256':digest,'precision':'FP32'})
     result['seconds']=time.monotonic()-start;results.append(result);Path(args.output).write_text(json.dumps(results,ensure_ascii=False));continue
    # torchvision CenterCrop uses round after symmetric zero padding.
    padx=max(0,336-w)//2;pady=max(0,336-h)//2
    left=round((max(w,336)-336)/2)-padx;top=round((max(h,336)-336)/2)-pady
    blur=crop.filter(ImageFilter.GaussianBlur(18));mean=tuple(int(x) for x in np.asarray(crop).mean((0,1)));flat=Image.new('RGB',crop.size,mean)
    variants=[];boxes=[]
    for y in range(4):
     for x in range(4):
      box=(x*84,y*84,(x+1)*84,(y+1)*84);boxes.append(box)
      for fill in [blur,flat]:
       masked=crop.copy();masked.paste(fill.crop(box),box);variants.append(masked)
    predictions=predictor.predict(variants,batch_size=4);cells=[]
    heat=Image.new('RGBA',rgb.size,(0,0,0,0));from PIL import ImageDraw
    draw=ImageDraw.Draw(heat)
    for i,b in enumerate(boxes):
     drops=[score-predictions[2*i+j]['fake_probability'] for j in range(2)];delta=min(drops);rect=[max(0,min(w,b[0]+left)),max(0,min(h,b[1]+top)),max(0,min(w,b[2]+left)),max(0,min(h,b[3]+top))]
     marked=score>.5 and delta>=.05 and rect[2]>rect[0] and rect[3]>rect[1]
     if marked:draw.rectangle(rect,fill=(239,54,110,int(80+min(delta,1)*130)),outline=(255,110,140,230),width=2)
     cells.append({'box':rect,'drops':drops,'maskedScores':[predictions[2*i+j]['fake_probability'] for j in range(2)],'marked':marked})
    # bounded display layer (natural source coordinates retained in cells)
    heat.thumbnail((1200,1200));diag['layers']['sensitivity']=png(heat)
    result.update(verdict='likely_ai' if score>.5 else 'no_obvious_ai',score=score,summary='发现较强的AI生成线索。' if score>.5 else '本次检测未发现明显AI生成线索。',coverage='中心336×336区域；边缘未参与本次模型判断。',model={'id':predictor.model_id,'weightsSha256':digest,'threshold':.5,'precision':'FP32','preprocess':'RGB; CenterCrop336 with zero padding; CLIP normalization; no resize or EXIF transpose'},sensitivity={'status':'completed','threshold':.05,'baseline':score,'cropParityError':abs(score-crop_score),'crop':[max(0,left),max(0,top),min(w,left+336),min(h,top+336)],'cells':cells,'markedCount':sum(c['marked'] for c in cells),'method':'blur_and_mean_occlusion_4x4','meaning':'classification_response_not_pixel_truth'})
   result['seconds']=time.monotonic()-start
  except Exception as e:result={'id':row['id'],'status':'failed','error':type(e).__name__,'seconds':time.monotonic()-start}
  results.append(result);Path(args.output).write_text(json.dumps(results,ensure_ascii=False));print(json.dumps({'id':row['id'],'status':result['status'],'score':result.get('score'),'seconds':result['seconds']}),flush=True)
if __name__=='__main__':main()
