"""Explicit research image-upload experiment; separate from text-only product adapter.
Run with --env, --manifest and --output. Each call uses a fresh conversation.
"""
import argparse, base64, hashlib, io, json, sys, time
from pathlib import Path
from urllib import request, error
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'src/modules/image/documents/python'))
from deepseek_explainer import read_settings, NoRedirect

SYSTEM = '你是文档图像复核员。区分直接可见的视觉证据、内容逻辑矛盾和仅来自提示的信息。不得编造原始值或修改历史。'
BLIND = '''请独立检查图片是否有篡改迹象，不预设真假。返回 JSON：verdict（suspicious/no_visible_evidence/uncertain），regions（数组，每项含box：[x1,y1,x2,y2]原图像素坐标、visible_text、visual_evidence、content_inconsistency），limitations。只写实际有证据的区域。没有视觉证据时明确说明；内容矛盾不自动证明像素编辑。'''
HINTS = {
 '1fa5a7ac4f244aeb947fd1786432f991': [[183,699,551,734],[460,996,534,1030],[689,1122,762,1160],[688,1460,761,1497]],
 '3ca07343cf5e4654a34a4d867af2b08c': [[378,670,439,704],[323,750,334,781],[539,863,597,891],[529,904,606,930]],
}

def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('--native-prompts-report',type=Path);p.add_argument('--env',type=Path,required=True);p.add_argument('--manifest',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
 a=p.parse_args(); cfg=read_settings(a.env)
 native=json.loads(a.native_prompts_report.read_text()) if a.native_prompts_report else None
 if cfg.get('DEEPSEEK_ENABLED')!='true' or cfg.get('DEEPSEEK_BASE_URL')!='https://api.deepseek.com': raise ValueError('Requires enabled official endpoint')
 key=cfg['DEEPSEEK_API_KEY']; model=cfg['DEEPSEEK_MODEL']
 opener=request.build_opener(request.ProxyHandler({}),NoRedirect())
 report={'purpose':'user_authorized_research_image_comparison','model':model,'image_sent':True,'independent_test':False,'system_prompt':SYSTEM,'calls':[]}
 a.output.parent.mkdir(parents=True,exist_ok=True)
 if a.output.exists():
  previous=json.loads(a.output.read_text())
  if previous['model']!=model:raise ValueError('Cannot resume different model')
  report=previous
 for row in json.loads(a.manifest.read_text()):
  data=Path(row['path']).read_bytes(); sha=hashlib.sha256(data).hexdigest()
  if sha!=row['expected_sha256']:raise ValueError('Input hash mismatch')
  from PIL import Image
  with Image.open(row['path']) as im: size=list(im.size)
  trials=[('blind',BLIND)]
  if native:trials.append(('native_prompt_blind',native['user_prompt']))
  boxes=HINTS.get(row['sample_id'])
  if boxes:
   trials.append(('publisher_location_guided','已知本样本经过篡改。发布方给出的篡改候选位置为'+json.dumps(boxes)+'。请逐一读取这些框内当前可见文字，检查能否从图像独立看出修改痕迹。不要仅因提示就确认；看不出必须写看不出。'+BLIND))
   trials.append(('publisher_crops_guided','已知该样本经过篡改。第一张是完整图，随后四张为发布方候选位置的局部原图裁剪，顺序对应'+json.dumps(boxes)+'。请按裁剪顺序逐一读取中心候选数字，区分可见字体/背景异常和金额逻辑矛盾；没有视觉证据时明确说明。'+BLIND))
  else:
   trials.append(('false_hint_control','已知这张图片顶部区域 [20,20,420,180] 有篡改。请验证该位置能否看到修改痕迹；如果没有独立视觉证据，请明确拒绝确认。'+BLIND))
  for mode,prompt in trials:
   if mode!='native_prompt_blind':prompt+=' 原图宽高：'+json.dumps(size)+'。'
   if any(c['sample_id']==row['sample_id'] and c['mode']==mode and c.get('input_sha256')==sha and c.get('prompt')==prompt and c['status']=='succeeded' for c in report['calls']):continue
   body={'model':model,'messages':[{'role':'system','content':SYSTEM},{'role':'user','content':[{'type':'text','text':prompt},{'type':'image_url','image_url':{'url':'data:image/jpeg;base64,'+base64.b64encode(data).decode(),'detail':'original'}}]}],'thinking':{'type':'disabled'},'response_format':{'type':'json_object'},'max_tokens':int(cfg.get('DEEPSEEK_MAX_TOKENS','1200')),'temperature':0,'stream':False}
   if mode=='native_prompt_blind':
    body['messages'][0]['content']=native['system_prompt'];body.pop('response_format')
   if mode=='publisher_crops_guided':
    with Image.open(row['path']) as source:
     for box in boxes:
      x1,y1,x2,y2=box
      crop=source.crop((max(0,x1-35),max(0,y1-25),min(source.width,x2+35),min(source.height,y2+25)))
      buf=io.BytesIO();crop.save(buf,format='PNG')
      body['messages'][1]['content'].append({'type':'image_url','image_url':{'url':'data:image/png;base64,'+base64.b64encode(buf.getvalue()).decode(),'detail':'original'}})
   result={'sample_id':row['sample_id'],'label':row['label'],'input_sha256':sha,'size':size,'mode':mode,'system_prompt':body['messages'][0]['content'],'prompt':prompt,'hint_boxes':boxes if mode.startswith('publisher_') else None}
   start=time.monotonic()
   req=request.Request('https://api.deepseek.com/chat/completions',data=json.dumps(body).encode(),headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'})
   try:
    with opener.open(req,timeout=int(cfg.get('DEEPSEEK_TIMEOUT_SECONDS','60'))) as response: raw=response.read(1024*1024)
    if key in raw.decode(errors='replace'):raise ValueError('Credential echo rejected')
    parsed=json.loads(raw); choice=parsed['choices'][0]
    result.update(status='succeeded' if choice['finish_reason']=='stop' else 'incomplete',returned_model=parsed.get('model'),usage=parsed.get('usage'),finish_reason=choice['finish_reason'],raw_output=choice['message']['content'])
    try:result['parsed']=json.loads(result['raw_output'])
    except ValueError:
     if mode!='native_prompt_blind':result['parse_error']=True
   except error.HTTPError as exc:result.update(status='failed',error='http_'+str(exc.code))
   except Exception as exc:result.update(status='failed',error=type(exc).__name__)
   result['seconds']=round(time.monotonic()-start,3); report['calls'].append(result)
   a.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
   print(json.dumps({k:result.get(k) for k in ['sample_id','mode','status','error','seconds']},ensure_ascii=False),flush=True)
   if result.get('error') in ['http_401','http_402','http_403']:return 1
 latest={(x['sample_id'],x['mode']):x for x in report['calls']}
 return int(any(x['status']!='succeeded' for x in latest.values()))
if __name__=='__main__':raise SystemExit(main())
