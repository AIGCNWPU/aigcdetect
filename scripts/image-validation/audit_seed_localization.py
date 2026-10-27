"""Audit saved SEED localization against unverified publisher report rectangles.
This is box agreement, not pixel-mask accuracy or independent localization ground truth.
"""
import argparse,csv,hashlib,html,json,re
from pathlib import Path
import numpy as np
from PIL import Image,ImageOps,ImageDraw
from scipy.optimize import linear_sum_assignment

BOX_RE=re.compile(r'[\[［]\s*(\d+)\s*[,，]\s*(\d+)\s*[,，]\s*(\d+)\s*[,，]\s*(\d+)\s*[\]］]')
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def area(b):return (b[2]-b[0])*(b[3]-b[1])
def intersect(a,b):return max(0,min(a[2],b[2])-max(a[0],b[0]))*max(0,min(a[3],b[3])-max(a[1],b[1]))
def iou(a,b):
 v=intersect(a,b);return v/(area(a)+area(b)-v)
def match(matrix,threshold):
 if not matrix.size:return []
 valid=matrix>=threshold
 ri,pi=linear_sum_assignment(-(valid.astype(float)*1000+matrix*valid))
 return [{'reference':int(r),'prediction':int(p),'iou':float(matrix[r,p])} for r,p in zip(ri,pi) if valid[r,p]]
def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--run',type=Path,required=True);ap.add_argument('--metadata',type=Path,required=True);ap.add_argument('--output',type=Path,required=True);a=ap.parse_args()
 a.output.mkdir(parents=True,exist_ok=False)
 raw=json.loads((a.run/'results.json').read_text());samples=[r for r in raw['samples'] if r['label']==1]
 assert len(samples)==30
 with a.metadata.open() as f:meta=list(csv.DictReader(f))
 report={'purpose':'publisher_rectangle_agreement_audit','pixel_ground_truth_available':False,'new_inference':False,'source_sha256':sha(a.run/'results.json'),'metadata_sha256':sha(a.metadata),'matching':'maximum cardinality one-to-one; IoU thresholds .1/.3/.5; no prediction filtering','samples':[]}
 thumbs=[]
 for number,row in enumerate(samples,1):
  sid=row['sample_id'];assert sha(row['path'])==row['input_sha256']
  matches=[m for m in meta if Path(m['image_file']).stem==sid];assert len(matches)==1
  text=matches[0]['report_text'];seen=set();refs=[]
  image=ImageOps.exif_transpose(Image.open(row['path'])).convert('RGB');w,h=image.size
  assert [w,h]==row['oriented_size'] and row['exif_orientation']==1
  for m in BOX_RE.finditer(text):
   box=tuple(map(int,m.groups()))
   if box in seen:continue
   seen.add(box);assert 0<=box[0]<box[2]<=w and 0<=box[1]<box[3]<=h
   refs.append({'box':list(box),'source_excerpt':text[max(0,m.start()-40):m.end()+55]})
  assert refs
  preds=row['regions'];mask=np.asarray(Image.open(a.run/row['mask_file']))>0
  assert mask.shape==(h,w) and int(mask.sum())==sum(p['area_pixels'] for p in preds)
  matrix=np.array([[iou(r['box'],p['box']) for p in preds] for r in refs])
  reference_union=np.zeros((h,w),dtype=bool)
  for r in refs:
   x1,y1,x2,y2=r['box'];reference_union[y1:y2,x1:x2]=True
   r['mask_pixels_inside']=int(mask[y1:y2,x1:x2].sum());r['mask_fraction_of_rectangle']=r['mask_pixels_inside']/area(r['box'])
  for i,r in enumerate(refs):
   r['best_iou']=float(matrix[i].max()) if len(preds) else 0
   r['best_prediction']=int(matrix[i].argmax()) if len(preds) else None
   r['union_predicted_box_coverage']=None
   x1,y1,x2,y2=r['box'];coverage=np.zeros((y2-y1,x2-x1),bool)
   for p in preds:
    px1,py1,px2,py2=p['box'];ix1,iy1,ix2,iy2=max(x1,px1),max(y1,py1),min(x2,px2),min(y2,py2)
    if ix1<ix2 and iy1<iy2:coverage[iy1-y1:iy2-y1,ix1-x1:ix2-x1]=True
   r['union_predicted_box_coverage']=float(coverage.mean())
  matching={str(t):match(matrix,t) for t in [.1,.3,.5]}
  no_overlap=[i for i,p in enumerate(preds) if not any(intersect(p['box'],r['box'])>0 for r in refs)]
  outside=int((mask & ~reference_union).sum())
  item={'number':number,'sample_id':sid,'size':[w,h],'references':refs,'predictions':preds,'matches':matching,'unmatched_at_05':[i for i in range(len(refs)) if i not in {m['reference'] for m in matching['0.5']}], 'predictions_with_no_reference_overlap':no_overlap,'mask_pixels_outside_reference_boxes':outside,'outside_fraction_of_predicted_mask':outside/max(1,int(mask.sum())),'input_sha256':row['input_sha256'],'mask_sha256':sha(a.run/row['mask_file']),'publisher_report':text}
  report['samples'].append(item)
  # Render references and predictions in the original coordinate space, then resize for browsing.
  annotated=image.copy();draw=ImageDraw.Draw(annotated);lw=max(2,round(w/500))
  for i,r in enumerate(refs):draw.rectangle(r['box'],outline='#00a040',width=lw)
  for i,p in enumerate(preds):draw.rectangle(p['box'],outline='#ff3030',width=lw)
  annotated.thumbnail((1200,1800));annotated.save(a.output/f'{number:02d}-overlay.jpg',quality=92)
  # Each reference gets an expanded original-image crop with all intersecting predictions.
  cards=[]
  for i,r in enumerate(refs):
   x1,y1,x2,y2=r['box'];pad=max(25,int((y2-y1)*1.2));box=(max(0,x1-pad),max(0,y1-pad),min(w,x2+pad),min(h,y2+pad))
   crop=image.crop(box);d=ImageDraw.Draw(crop)
   for p in preds:
    if intersect(p['box'],box)>0:d.rectangle([p['box'][0]-box[0],p['box'][1]-box[1],p['box'][2]-box[0],p['box'][3]-box[1]],outline='#ff3030',width=2)
   d.rectangle([x1-box[0],y1-box[1],x2-box[0],y2-box[1]],outline='#00a040',width=2)
   crop.thumbnail((470,130));card=Image.new('RGB',(500,165),'white');card.paste(crop,(10,30));ImageDraw.Draw(card).text((10,6),f'R{i+1} best IoU={r["best_iou"]:.2f} box coverage={r["union_predicted_box_coverage"]:.2f}',fill='black');cards.append(card)
  contact=Image.new('RGB',(1000,35+165*((len(cards)+1)//2)),'#e8e8e8');d=ImageDraw.Draw(contact);d.text((8,8),f'{number:02d} {sid} | green=publisher; red=SEED',fill='black')
  for i,c in enumerate(cards):contact.paste(c,((i%2)*500,35+(i//2)*165))
  contact.save(a.output/f'{number:02d}-crops.jpg',quality=93)
  thumb=Image.new('RGB',(360,590),'white');annotated.thumbnail((350,540));thumb.paste(annotated,((360-annotated.width)//2,45));ImageDraw.Draw(thumb).text((6,5),f'{number:02d} ref={len(refs)} pred={len(preds)} hit@.5={len(matching["0.5"])}\noutside-mask={item["outside_fraction_of_predicted_mask"]:.1%}',fill='black');thumbs.append(thumb)
  print(f'{number:02d} refs={len(refs)} preds={len(preds)} hit05={len(matching["0.5"])} hit01={len(matching["0.1"])} outside={item["outside_fraction_of_predicted_mask"]:.3f}',flush=True)
 for batch in range(5):
  sheet=Image.new('RGB',(1080,1180),'#ddd')
  for k,t in enumerate(thumbs[batch*6:batch*6+6]):sheet.paste(t,((k%3)*360,(k//3)*590))
  sheet.save(a.output/f'overview-{batch+1}.jpg',quality=90)
 totalrefs=sum(len(r['references']) for r in report['samples']);totalpreds=sum(len(r['predictions']) for r in report['samples'])
 report['summary']={'images':len(samples),'reference_rectangles':totalrefs,'predicted_components':totalpreds,'thresholds':{str(t):{'matched_pairs':sum(len(r['matches'][str(t)]) for r in report['samples']),'images_with_any_match':sum(bool(r['matches'][str(t)]) for r in report['samples']),'images_all_references_matched':sum(len(r['matches'][str(t)])==len(r['references']) for r in report['samples'])} for t in [.1,.3,.5]},'zero_overlap_predictions':sum(len(r['predictions_with_no_reference_overlap']) for r in report['samples'])}
 (a.output/'audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
 with (a.output/'summary.csv').open('w') as f:
  cw=csv.writer(f);cw.writerow(['number','sample_id','reference_boxes','predicted_boxes','matched_iou05','unmatched_reference_ids','predictions_no_overlap','mask_outside_reference_fraction'])
  for r in report['samples']:cw.writerow([r['number'],r['sample_id'],len(r['references']),len(r['predictions']),len(r['matches']['0.5']),[x+1 for x in r['unmatched_at_05']],len(r['predictions_with_no_reference_overlap']),r['outside_fraction_of_predicted_mask']])
 esc=html.escape
 parts=['<!doctype html><meta charset="utf-8"><title>SEED 30 张篡改定位复核</title><style>body{max-width:1200px;margin:30px auto;font:16px/1.7 system-ui;padding:20px}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:6px}pre{white-space:pre-wrap}details{margin:20px 0}a{color:#1359b5}</style><h1>SEED 30 张篡改定位复核</h1><p>2026-10-22。复用固定版本已完成的 SEED 推理，逐图核验原图 SHA-256 和掩码面积，不重新推理、不调阈值、不筛选预测框。绿色：发布方说明中的参考框；红色：SEED 原始连通区域框。</p><p><b>参考框来自发布方自然语言说明，并非独立人工真值或像素掩码。</b>以下 IoU 仅表示框坐标的一致程度，不是像素分割成绩。额外框可能误报，也可能是发布说明漏列；每张图片报警不等于框对。</p><pre>'+esc(json.dumps(report['summary'],ensure_ascii=False,indent=2))+'</pre><p>一对一最大数量匹配，IoU=交集面积/并集面积。主要查看 0.5，同时保留 0.1/0.3 灵敏度；部分命中可能切断日期或只框中字符片段。未使用参考矩形冒充真值 mask。</p><p><a href="summary.csv">逐图表格 CSV</a> · <a href="audit.json">完整坐标及匹配记录</a></p>']
 for r in report['samples']:
  n=r['number'];parts.append(f'<section id="sample-{n}"><h2>{n:02d} {r["sample_id"]}</h2><p>参考框 {len(r["references"])}，预测框 {len(r["predictions"])}；IoU≥0.5 匹配 {len(r["matches"]["0.5"])}；与所有参考框均不相交的预测框 {len(r["predictions_with_no_reference_overlap"])}。</p><img loading="lazy" src="{n:02d}-crops.jpg"><details><summary>整图定位</summary><img loading="lazy" src="{n:02d}-overlay.jpg"></details><details><summary>发布方原始说明（未经独立验证）</summary><p>'+esc(r['publisher_report'])+'</p></details></section>')
 (a.output/'index.html').write_text('\n'.join(parts))
 print(json.dumps(report['summary']))
if __name__=='__main__':main()
