"""Authenticated single-module Streamable HTTP MCP adapter for existing video APIs."""
import asyncio,base64,hashlib,hmac,ipaddress,json,os,socket,time,uuid
from pathlib import Path
from urllib.parse import urlsplit,urljoin
import httpx
from mcp.server.fastmcp import FastMCP
from starlette.responses import JSONResponse
from mcp.server.transport_security import TransportSecuritySettings
import uvicorn

MODULE=os.environ['VIDEO_MODULE'];assert MODULE in ('general','deepfake')
PORT=int(os.environ.get('VIDEO_MCP_PORT','18610' if MODULE=='general' else '18611'))
API='http://127.0.0.1:'+('8600' if MODULE=='general' else '8601')
ROOT=Path(__file__).resolve().parent
JOBS=ROOT/'jobs'/MODULE;JOBS.mkdir(parents=True,exist_ok=True)
UPLOADS=ROOT/'uploads';UPLOADS.mkdir(exist_ok=True)
TOKEN=(ROOT/(MODULE+'.token')).read_text().strip()
MAX=100*1024*1024
mcp=FastMCP('veritas-video-'+MODULE,host='127.0.0.1',port=PORT,stateless_http=True,json_response=True)
mcp.settings.transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=True,allowed_hosts=['127.0.0.1:*','localhost:*']+os.environ.get('VIDEO_PUBLIC_HOSTS','').split(','),allowed_origins=['https://'+h for h in os.environ.get('VIDEO_PUBLIC_HOSTS','').split(',') if h])
semaphore=asyncio.Semaphore(1);tasks={}

def clean(value):
 if isinstance(value,dict):return {k:clean(v) for k,v in value.items() if k.lower() not in ('image','thumbnail','dataurl','base64','preview','artifactsdir')}
 if isinstance(value,list):return [clean(x) for x in value]
 if isinstance(value,str) and (value.startswith('data:') or len(value)>10000):return '[large evidence stored in server JSON]'
 return value

def directory(jid):
 if len(jid)!=32 or any(c not in '0123456789abcdef' for c in jid):raise ValueError('Invalid job_id')
 d=JOBS/jid
 if not (d/'status.json').exists():raise ValueError('Unknown job_id')
 return d

def save(d,state):
 t=d/'status.tmp';t.write_text(json.dumps(state,ensure_ascii=False));t.replace(d/'status.json')

def public_url(url):
 u=urlsplit(url)
 if u.scheme!='https' or not u.hostname or u.username or u.password or u.port not in (None,443):raise ValueError('Only public HTTPS URLs on port443 without credentials are accepted')
 for x in socket.getaddrinfo(u.hostname,443,type=socket.SOCK_STREAM):
  if not ipaddress.ip_address(x[4][0]).is_global:raise ValueError('Private/reserved network URLs are not allowed')
 return url

async def download(url,d):
 p=d/'input.mp4'
 async with httpx.AsyncClient(timeout=120,trust_env=False,follow_redirects=False) as client:
  for _ in range(4):
   await asyncio.to_thread(public_url,url)
   async with client.stream('GET',url) as resp:
    if resp.status_code in (301,302,303,307,308):url=urljoin(url,resp.headers['location']);continue
    resp.raise_for_status();size=0
    with p.open('wb') as f:
     async for chunk in resp.aiter_bytes():
      size+=len(chunk)
      if size>MAX:raise ValueError('Video exceeds100MiB')
      f.write(chunk)
    if not size:raise ValueError('Empty video')
    return p
 raise ValueError('Too many redirects')

async def run(jid,url,path):
 d=JOBS/jid;state={'job_id':jid,'module':MODULE,'status':'queued'}
 try:
  async with semaphore:
   state['status']='running';save(d,state)
   p=await download(url,d) if url else path
   async with httpx.AsyncClient(timeout=1800,trust_env=False) as client:
    with p.open('rb') as f:resp=await client.post(API+'/detect',files={'video':(p.name,f,'video/mp4')})
    resp.raise_for_status();raw=resp.json();result=raw.get('data',raw)
   if result.get('risk') not in ('low','medium','high','unknown'):raise ValueError('Invalid backend result')
   (d/'result.json').write_text(json.dumps(raw,ensure_ascii=False))
   summary=clean(result);(d/'compact.json').write_text(json.dumps(summary,ensure_ascii=False))
   lines=['# 视频检测报告','',f'模块：{MODULE}',f'风险：{result["risk"]}','',str(result.get('summary','')),'','仅覆盖采样内容，风险分数不等于真实性概率。人物关联不代表身份认证。']
   (d/'report.md').write_text('\n'.join(lines));state.update(status='completed',risk=result['risk'],summary=result.get('summary',''))
 except Exception as e:state.update(status='failed',error=f'{type(e).__name__}: {str(e)[:300]}')
 finally:
  save(d,state)
  if url:(d/'input.mp4').unlink(missing_ok=True)

@mcp.tool()
async def get_detection_status() -> dict:
 """查询本模块后端就绪状态。不会运行检测或调用外部视觉模型。"""
 try:
  async with httpx.AsyncClient(timeout=15,trust_env=False) as client:
   r=await client.get(API+'/health');r.raise_for_status();body=r.json()
  return {'module':MODULE,'backend':clean(body),'external_review_notice':'Existing backend may call external vision models during detection. Explicit authorization is required.'}
 except Exception as e:return {'module':MODULE,'ready':False,'error':type(e).__name__}

@mcp.tool()
async def submit_video_detection(video_url: str='',video_path: str='',allow_external_review: bool=False) -> dict:
 """提交本模块检测，返回job_id后轮询。提供公网HTTPS视频URL，或服务器uploads目录内的视频绝对路径，二选一。最大100MiB，人脸视频最长120秒。现有后端含外部视觉复核；必须经用户同意该费用/传输后将allow_external_review设true。"""
 if not allow_external_review:raise ValueError('Existing backend may send frames to external review; obtain user authorization including costs before setting allow_external_review=true')
 if bool(video_url)==bool(video_path):raise ValueError('Supply exactly one video_url or video_path')
 if sum(not t.done() for t in tasks.values())>=8:raise ValueError('Queue full')
 p=None
 if video_path:
  p=Path(video_path).expanduser().resolve()
  if not p.is_relative_to(UPLOADS.resolve()) or not p.is_file() or not 0<p.stat().st_size<=MAX:raise ValueError('Video must be <=100MiB and under server uploads directory')
 if video_url:await asyncio.to_thread(public_url,video_url)
 jid=uuid.uuid4().hex;d=JOBS/jid;d.mkdir();state={'job_id':jid,'module':MODULE,'status':'queued'};save(d,state)
 tasks[jid]=asyncio.create_task(run(jid,video_url,p))
 return state

@mcp.tool()
def get_detection_result(job_id: str,include_details: bool=False) -> dict:
 """查询任务状态、风险与摘要；include_details可获取移除大图后的结构化证据。"""
 d=directory(job_id);state=json.loads((d/'status.json').read_text())
 if state['status'] in ('queued','running') and job_id not in tasks:state.update(status='interrupted',error='Service restarted; submit a new job')
 if include_details and (d/'compact.json').exists():state['details']=json.loads((d/'compact.json').read_text())
 return state

@mcp.tool()
def get_detection_report(job_id: str) -> str:
 """获取已完成任务的Markdown检测报告。"""
 p=directory(job_id)/'report.md'
 if not p.exists():raise ValueError('Report not ready')
 return p.read_text()

class BearerAuth:
 def __init__(self,app):self.app=app
 async def __call__(self,scope,receive,send):
  if scope['type']=='http':
   headers=dict(scope.get('headers',[]));auth=headers.get(b'authorization',b'').decode(errors='replace')
   if not hmac.compare_digest(auth,'Bearer '+TOKEN):
    await JSONResponse({'error':'Unauthorized'},status_code=401)(scope,receive,send);return
  await self.app(scope,receive,send)

if __name__=='__main__':uvicorn.run(BearerAuth(mcp.streamable_http_app()),host='127.0.0.1',port=PORT,access_log=False)
