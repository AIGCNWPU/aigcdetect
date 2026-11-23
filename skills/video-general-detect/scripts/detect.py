"""Local video detector CLI. Standard library only; inference dependencies belong to runtime."""
import argparse, datetime, http.client, json, os, socket, sys, urllib.parse, uuid
from pathlib import Path
MODULE = 'general'
DEFAULT_PORT = 18600
MAX_BYTES = 500 * 1024 * 1024
ROOT = Path(__file__).resolve().parents[1]

def connect(base, allow_remote=False, timeout=900):
    u=urllib.parse.urlsplit(base)
    if u.scheme not in ('http','https') or not u.hostname or u.username or u.password or u.query or u.fragment:
        raise ValueError('Endpoint must be an http(s) service URL without credentials/query/fragment.')
    if u.hostname not in ('localhost','127.0.0.1','::1') and not allow_remote:
        raise ValueError('Remote uploads require explicit --allow-remote and user authorization.')
    cls=http.client.HTTPSConnection if u.scheme=='https' else http.client.HTTPConnection
    return cls(u.hostname,u.port,timeout=timeout),u.path.rstrip('/')

def health(base, allow_remote=False):
    conn,path=connect(base,allow_remote,10)
    try:
        conn.request('GET',path+'/health');res=conn.getresponse();body=json.loads(res.read())
        if res.status!=200:raise RuntimeError(f'Health returned HTTP {res.status}')
        return body
    finally:conn.close()

def detect(args):
    p=Path(args.video).expanduser().resolve()
    if not p.is_file():raise ValueError('Video file does not exist.')
    if not 0<p.stat().st_size<=MAX_BYTES:raise ValueError(f'Video must be nonempty and <= {MAX_BYTES//1048576} MiB.')
    h=health(args.endpoint,args.allow_remote)
    if not (h.get('ready') or h.get('modelReady')):raise RuntimeError('Model is not ready; inspect health output.')
    info=h.get('skill') or {}
    if info.get('module')!=MODULE:raise RuntimeError('Endpoint is not this skill runtime; start the bundled runtime on its own port.')
    if info.get('externalReview') and not args.allow_external_review:raise RuntimeError('Service has external review enabled; authorization and --allow-external-review are required before uploading.')
    boundary='skill-'+uuid.uuid4().hex
    filename=p.name.replace('"','_').replace('\r','_').replace('\n','_')
    head=(f'--{boundary}\r\nContent-Disposition: form-data; name="video"; filename="{filename}"\r\nContent-Type: application/octet-stream\r\n\r\n').encode('utf-8')
    tail=f'\r\n--{boundary}--\r\n'.encode()
    conn,path=connect(args.endpoint,args.allow_remote,args.timeout)
    try:
        conn.putrequest('POST',path+'/detect');conn.putheader('Content-Type','multipart/form-data; boundary='+boundary)
        conn.putheader('Content-Length',str(len(head)+p.stat().st_size+len(tail)));conn.endheaders();conn.send(head)
        with p.open('rb') as f:
            for chunk in iter(lambda:f.read(1024*1024),b''):conn.send(chunk)
        conn.send(tail);res=conn.getresponse();raw=res.read();body=json.loads(raw)
        if res.status!=200:raise RuntimeError(f'HTTP {res.status}: {str(body.get("detail",body))[:400]}')
    finally:conn.close()
    result=body.get('data',body)
    if not isinstance(result,dict) or result.get('risk') not in ('low','medium','high','unknown'):raise RuntimeError('Invalid detection result; no report generated.')
    dest=Path(args.output).expanduser().resolve();dest.mkdir(parents=True,exist_ok=True)
    stem=MODULE+'-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:6]
    jp=dest/(stem+'.json');mp=dest/(stem+'.md');jp.write_text(json.dumps(body,ensure_ascii=False,indent=2),encoding='utf-8')
    meta=result.get('meta') or {};lines=['# 视频检测报告','',f'- 文件：{filename}',f'- 模块：{MODULE}',f'- 风险：{result["risk"]}',f'- 检测覆盖：{result.get("coverage","partial")}',f'- 服务：{args.endpoint}','',str(result.get('summary','')),'',str(result.get('scope','')),'','## 线索','']
    lines += ['- '+str(x) for x in result.get('findings',[])]
    persons=result.get('persons',[])
    if persons:
        lines+=['','## 人物结果','']
        lines += [f'- {x.get("label",x.get("id","人物"))}：{x.get("risk","unknown")}' for x in persons]
    segments=result.get('segments') or [s for x in persons for s in x.get('segments',[])]
    lines+=['','## 采样风险片段','']
    lines += [f'- {s.get("start","?")}–{s.get("end","?")} 秒：{s.get("risk","unknown")}；{s.get("summary",s.get("explanation",""))}' for s in segments]
    lines+=['','## 解释范围','','仅覆盖实际采样内容。模型得分和标识规则赋值不等于真实性概率；没有检出不证明真实。人物关联不是身份认证。','',f'完整证据及模型原始得分见：[{jp.name}]({jp.name})。']
    if result.get('aiGeneratedMarker') or meta.get('aiMarker') or result.get('visualAiMarker'):
        lines+=['','检测到AI声明/元数据或可见标识；应与模型原始结论分开解释，不构成经签名验证的来源证明。']
    mp.write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print(json.dumps({'risk':result['risk'],'json':str(jp),'report':str(mp)},ensure_ascii=False))

def start(args):
    runtime=ROOT/'assets/runtime';env=dict(os.environ)
    env['CUDA_VISIBLE_DEVICES']='';env['NATIVE_SCALE_DEVICE']='cpu';env['VLAFORGE_DEVICE']='cpu';env['VIDEO_TORCH_THREADS']='4'
    env['AIGC_SKILL_EXTERNAL_REVIEW']='1' if args.allow_external_review else '0'
    if MODULE=='general':
        weights=Path(args.weights_dir).expanduser().resolve() if args.weights_dir else runtime/'artifacts'
        for f in ['config.json','Qwen2.5-ViT_140k_224p_448p.pth']:
            if not (weights/f).is_file():raise ValueError('Missing weight/config: '+str(weights/f))
        env['NATIVE_SCALE_ARTIFACTS']=str(weights)
    else:
        for attr,key,default in [('weights','VLAFORGE_CHECKPOINT','model.pth'),('face_model','YUNET_CHECKPOINT','face_detection_yunet.onnx')]:
            p=Path(getattr(args,attr)).expanduser().resolve() if getattr(args,attr) else runtime/'artifacts'/default
            if not p.is_file():raise ValueError('Missing model: '+str(p))
            env[key]=str(p)
    with socket.socket() as s:
        if s.connect_ex(('127.0.0.1',args.port))==0:raise ValueError(f'Port {args.port} occupied; inspect health or choose --port. Existing service not modified.')
    os.chdir(runtime)
    os.execvpe(args.python,[args.python,'-m','uvicorn','app:app','--host','127.0.0.1','--port',str(args.port)],env)

def main():
    parser=argparse.ArgumentParser(description=f'{MODULE} video detection skill (CPU/local by default)');sub=parser.add_subparsers(dest='command',required=True)
    h=sub.add_parser('health');h.add_argument('--endpoint',default=f'http://127.0.0.1:{DEFAULT_PORT}');h.add_argument('--allow-remote',action='store_true')
    d=sub.add_parser('detect');d.add_argument('video');d.add_argument('--endpoint',default=f'http://127.0.0.1:{DEFAULT_PORT}');d.add_argument('--output',default='outputs/video-detection');d.add_argument('--timeout',type=int,default=900);d.add_argument('--allow-remote',action='store_true');d.add_argument('--allow-external-review',action='store_true')
    s=sub.add_parser('start');s.add_argument('--python',default=sys.executable);s.add_argument('--port',type=int,default=DEFAULT_PORT);s.add_argument('--weights-dir');s.add_argument('--weights');s.add_argument('--face-model');s.add_argument('--allow-external-review',action='store_true')
    args=parser.parse_args()
    try:
        if args.command=='health':print(json.dumps(health(args.endpoint,args.allow_remote),ensure_ascii=False,indent=2))
        elif args.command=='start':start(args)
        else:detect(args)
    except Exception as e:print(str(e),file=sys.stderr);return 1
    return 0
if __name__=='__main__':raise SystemExit(main())
