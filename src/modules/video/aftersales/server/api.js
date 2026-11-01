import os from 'node:os';
import path from 'node:path';
import { readFileSync, createWriteStream } from 'node:fs';
import { mkdtemp, mkdir, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { validateAftersalesVideoFields, aftersalesVideoFieldLimits, aftersalesVideoLimits } from '../materials.js';
import { validateAftersalesVideoResult } from '../detection.js';
import { createVideoProviders, VideoServiceError } from './providers.js';

const execute=promisify(execFile),rootPath='/api/v1/video/aftersales',sessionPattern=/^v_[a-f0-9-]{36}$/,jobPattern=/^vj_[a-f0-9-]{36}$/;
const send=(response,status,data,headers={})=>{if(response.destroyed)return;response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});response.end(JSON.stringify(data));};
function videoRouteMethod(route){
  if(route==='/status' || /^\/jobs\/vj_[a-f0-9-]{36}$/.test(route))return 'GET';
  if(/^\/sessions\/v_[a-f0-9-]{36}\/videos\/[a-zA-Z0-9_-]{1,100}$/.test(route))return 'PUT';
  if(['','/sessions','/jobs'].includes(route) || /^\/sessions\/v_[a-f0-9-]{36}\/close$/.test(route) || /^\/jobs\/vj_[a-f0-9-]{36}\/cancel$/.test(route))return 'POST';
  return null;
}
export function loadVideoConfig(){
  const base=path.join(os.homedir(),'.config/veritas');let config={};
  try{config=JSON.parse(readFileSync(process.env.VERITAS_VIDEO_CONFIG||path.join(base,'video-aftersales.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw new Error('视频服务配置格式无效。');}
  if(!config.deepseek)try{config.deepseek=JSON.parse(readFileSync(process.env.VERITAS_REFUND_CONFIG||path.join(base,'image-refund.json'),'utf8')).deepseek;}catch{}
  return config;
}
async function payload(request){
  if(!request.headers['content-type']?.startsWith('application/json'))throw new VideoServiceError('请提交 JSON 元数据。',415);
  let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>32768)throw new VideoServiceError('元数据过大。',413);chunks.push(chunk);}
  try{const value=JSON.parse(Buffer.concat(chunks));if(!value||Array.isArray(value)||typeof value!=='object')throw 0;return value;}catch{throw new VideoServiceError('元数据格式无效。');}
}
export async function inspectVideo(filename,expected,signal){
  let probe;
  try{
    const {stdout}=await execute(process.env.VERITAS_FFPROBE||'ffprobe',['-v','error','-show_format','-show_streams','-of','json',filename],{signal,timeout:30000,maxBuffer:1024*1024});probe=JSON.parse(stdout);
  }catch{throw new VideoServiceError('无法解码视频或读取元数据，请选择完整的视频文件。',422,'INVALID_VIDEO');}
  const stream=probe.streams?.find(s=>s.codec_type==='video'&&!s.disposition?.attached_pic),duration=Math.max(Number(stream?.duration)||0,Number(probe.format?.duration)||0);
  const format=String(probe.format?.format_name||''),rotation=Math.abs(Number(stream?.side_data_list?.find(s=>s.rotation!==undefined)?.rotation||stream?.tags?.rotate||0))%180;
  let width=stream?.width,height=stream?.height;if(rotation===90)[width,height]=[height,width];
  if(!stream||!Number.isFinite(duration)||duration<=0||duration>600.5||width!==expected.width||height!==expected.height||Math.abs(duration-expected.duration)>.5||maxDimension(width,height)>4096||width*height>9000000||!(expected.type==='video/mp4'?format.includes('mp4'):format.includes('webm')))throw new VideoServiceError('视频实际格式、时长或尺寸与提交资料不符，或超过 4K 限制。',422,'INVALID_VIDEO');
  return {duration,width,height};
}
const maxDimension=(w,h)=>Math.max(w,h);

export function createVideoApi({config=loadVideoConfig(),providers=createVideoProviders(config),inspect=inspectVideo,ttlMs=30*60000,maxBytes=1024**3,maxSessions=3,tempBase=os.tmpdir()}={}){
  const sessions=new Map(),jobs=new Map(),cancelled=new Set(),closedIds=new Set();let closed=false,active=null,uploads=0,reserved=0;
  const ownRoot=mkdtemp(path.join(tempBase,'veritas-current-video-')).then(async directory=>{await writeFile(path.join(directory,'owner.json'),JSON.stringify({pid:process.pid,started:Date.now()}),{mode:0o600});return directory;});
  // Only reap our private directories whose recorded process no longer exists.
  const cleanupStale=(async()=>{for(const name of await readdir(tempBase)){if(!/^veritas-current-video-[A-Za-z0-9]+$/.test(name))continue;const dir=path.join(tempBase,name);try{const owner=JSON.parse(await readFile(path.join(dir,'owner.json'),'utf8'));if(!Number.isInteger(owner.pid)||owner.pid<=0)continue;try{process.kill(owner.pid,0);}catch(error){if(error.code==='ESRCH')await rm(dir,{recursive:true,force:true});}}catch{}}})();
  const remember=(set,id)=>{set.add(id);if(set.size>1000)set.delete(set.values().next().value);};
  function get(id){const s=sessions.get(id);if(!s)throw new VideoServiceError('本次材料已关闭或过期，请重新提交。',410,'SESSION_EXPIRED');s.touched=Date.now();return s;}
  function input(id,videoId){const s=get(id),video=s.videos.find(v=>v.id===videoId);if(!video||video.status!=='ready')throw new VideoServiceError('视频尚未完整上传。',409,'VIDEO_NOT_READY');return {fields:s.fields,video,path:video.path,sha256:video.sha256};}
  function publicSession(s){return {id:s.id,videos:s.videos.map(v=>({id:v.id,version:v.version,status:v.status,sha256:v.sha256})),expiresInSeconds:Math.ceil(ttlMs/1000)};}
  function cancel(id){remember(cancelled,id);const job=jobs.get(id);if(job&&['queued','running'].includes(job.status)){job.status='cancelled';job.result=null;job.error='检测已取消。';job.controller?.abort();}return job;}
  async function closeSession(id){remember(closedIds,id);const s=sessions.get(id);if(!s)return;sessions.delete(id);reserved-=s.bytes;s.controller.abort();for(const [key,job] of jobs)if(job.sessionId===id){cancel(key);jobs.delete(key);}if(s.directory)await rm(s.directory,{recursive:true,force:true});}
  const snapshot=job=>{const {controller,...rest}=job;return rest;};
  function schedule(){
    if(closed||active)return;
    const job=[...jobs.values()].find(j=>j.status==='queued');if(!job)return;active=job;job.status='running';job.controller=new AbortController();
    void(async()=>{try{
      const value=input(job.sessionId,job.videoId);if(value.video.version!==job.version)throw new VideoServiceError('视频版本已变化。',409);
      const signal=AbortSignal.any([job.controller.signal,AbortSignal.timeout(300000)]);
      const result=await providers.run(job.kind,value,signal);signal.throwIfAborted();
      if(job.status!=='running'||!sessions.has(job.sessionId)||jobs.get(job.id)!==job)return;
      job.result=validateAftersalesVideoResult(result,value.video,job.kind,value.fields);job.status='succeeded';
    }catch(error){if(job.status==='running'&&jobs.get(job.id)===job){job.status='failed';job.error=error instanceof VideoServiceError?error.message:'视频检测失败或超时，请重试。';job.errorCode=error.code||'DETECTION_FAILED';}}
    finally{delete job.controller;active=null;schedule();}})();
  }
  const timer=setInterval(()=>{for(const s of sessions.values())if(Date.now()-s.touched>ttlMs)void closeSession(s.id);},Math.min(60000,ttlMs));timer.unref();
  return {
    async close(){closed=true;clearInterval(timer);await Promise.all([...sessions.keys()].map(closeSession));jobs.clear();await cleanupStale;await rm(await ownRoot,{recursive:true,force:true});},
    async handle(request,response,pathname,requestId){
      if(pathname!==rootPath&&!pathname.startsWith(rootPath+'/'))return false;
      try{
        const host=request.headers.host||'',origin=request.headers.origin;
        if(!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)||(origin&&origin!==`http://${host}`)||request.headers['sec-fetch-site']==='cross-site')throw new VideoServiceError('只允许本机页面访问分析服务。',403,'ORIGIN_FORBIDDEN');
        if(closed)throw new VideoServiceError('服务已关闭。',503);
        const route=pathname.slice(rootPath.length),method=request.method;
        const allowed=videoRouteMethod(route);
        if(allowed && method!==allowed){send(response,405,{error:{code:'METHOD_NOT_ALLOWED',message:`请使用 ${allowed}`},requestId},{Allow:allowed});return true;}
        if(route==='/status'&&method==='GET'){send(response,200,{version:1,storage:'temporary-current-upload',capabilities:providers.capabilities,limits:{count:5,bytes:aftersalesVideoLimits.bytes,seconds:600}});return true;}
        if((route===''||route==='/sessions')&&method==='POST'){
          const body=await payload(request),id=body.id||'v_'+randomUUID();
          if(!sessionPattern.test(id)||closedIds.has(id))throw new VideoServiceError('本次材料编号无效或已关闭。',409);
          const fields=Object.fromEntries(Object.keys(aftersalesVideoFieldLimits).map(k=>[k,String(body.fields?.[k]??'').trim()]));
          const errors=validateAftersalesVideoFields(fields);if(Object.keys(errors).length)throw new VideoServiceError(Object.values(errors)[0]);
          if(!Array.isArray(body.videos)||!body.videos.length||body.videos.length>5)throw new VideoServiceError('请选择 1–5 个视频。');
          const ids=new Set(),videos=body.videos.map(v=>{
            if(!v||typeof v.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(v.id)||ids.has(v.id)||!Number.isInteger(v.version)||v.version<0||!['video/mp4','video/webm'].includes(v.type)||!Number.isSafeInteger(v.size)||v.size<=0||v.size>aftersalesVideoLimits.bytes||!Number.isFinite(v.duration)||v.duration<=0||v.duration>600||!Number.isInteger(v.width)||!Number.isInteger(v.height)||Math.min(v.width,v.height)<=0||maxDimension(v.width,v.height)>4096||v.width*v.height>9000000)throw new VideoServiceError('视频元数据无效或超出限制。');
            ids.add(v.id);return {id:v.id,version:v.version,type:v.type,size:v.size,duration:v.duration,width:v.width,height:v.height,status:'pending'};
          });
          const signature=JSON.stringify({fields,videos}),existing=sessions.get(id);
          if(existing){if(existing.signature!==signature)throw new VideoServiceError('材料编号与内容冲突。',409);send(response,200,{accepted:true,receiptId:id,session:publicSession(existing)});return true;}
          const bytes=videos.reduce((sum,v)=>sum+v.size,0);if(sessions.size>=maxSessions||reserved+bytes>maxBytes)throw new VideoServiceError('当前临时材料占用已达上限，请关闭其他分析后重试。',429,'BUSY');
          const s={id,fields,videos,signature,bytes,touched:Date.now(),controller:new AbortController(),directory:null};sessions.set(id,s);reserved+=bytes;
          try{s.directory=path.join(await ownRoot,id);if(!sessions.has(id))throw new VideoServiceError('材料已关闭。',409);await mkdir(s.directory,{mode:0o700});if(!sessions.has(id)){await rm(s.directory,{recursive:true,force:true});throw new VideoServiceError('材料已关闭。',409);}}catch(error){await closeSession(id);throw error;}
          send(response,200,{accepted:true,receiptId:id,session:publicSession(s),requestId});return true;
        }
        const closeMatch=route.match(/^\/sessions\/(v_[a-f0-9-]{36})\/close$/);
        if(closeMatch&&method==='POST'){await closeSession(closeMatch[1]);send(response,200,{closed:true});return true;}
        const upload=route.match(/^\/sessions\/(v_[a-f0-9-]{36})\/videos\/([a-zA-Z0-9_-]{1,100})$/);
        if(upload&&method==='PUT'){
          const s=get(upload[1]),video=s.videos.find(v=>v.id===upload[2]);
          if(!video)throw new VideoServiceError('视频编号与材料不匹配。',404);
          if(video.status==='uploading'||uploads>=2)throw new VideoServiceError('视频正在上传，请稍后重试。',429,'BUSY');
          if(video.status==='ready')throw new VideoServiceError('该视频已经接收，请直接开始检测。',409);
          if(request.headers['content-type']!==video.type||Number(request.headers['content-length'])!==video.size)throw new VideoServiceError('上传格式或字节数与材料不一致。',400);
          uploads++;video.status='uploading';const filename=path.join(s.directory,video.id+'.upload');let size=0;const hash=createHash('sha256');
          try{
            const signal=AbortSignal.any([s.controller.signal,AbortSignal.timeout(180000)]);
            const meter=new Transform({transform(chunk,encoding,callback){size+=chunk.length;if(size>video.size)return callback(new VideoServiceError('上传内容超限。',413));hash.update(chunk);callback(null,chunk);}});
            await pipeline(request,meter,createWriteStream(filename,{flags:'wx',mode:0o600}),{signal});
            if(size!==video.size)throw new VideoServiceError('视频上传未完成。',422);
            await inspect(filename,video,signal);signal.throwIfAborted();
            if(!sessions.has(s.id))throw new VideoServiceError('本次材料已关闭。',410);
            Object.assign(video,{status:'ready',path:filename,sha256:hash.digest('hex')});s.touched=Date.now();send(response,200,{accepted:true,video:{id:video.id,version:video.version,sha256:video.sha256}});
          }catch(error){video.status='pending';await rm(filename,{force:true});throw error;}finally{uploads--;}
          return true;
        }
        if(route==='/jobs'&&method==='POST'){
          const body=await payload(request),id=body.id||'vj_'+randomUUID();
          if(!jobPattern.test(id)||!['ai','tamper','comparison'].includes(body.kind))throw new VideoServiceError('任务编号或类型无效。');
          if(!providers.capabilities[body.kind])throw new VideoServiceError('该分析能力尚未接入。',503,'NOT_CONFIGURED');
          const value=input(body.sessionId,body.videoId);if(body.version!==value.video.version)throw new VideoServiceError('视频版本不匹配。',409,'VERSION_MISMATCH');
          const existing=jobs.get(id);if(existing){if(['sessionId','videoId','version','kind'].some(k=>existing[k]!==body[k]))throw new VideoServiceError('任务编号与材料冲突。',409);send(response,200,{job:snapshot(existing)});return true;}
          if(jobs.size>=120||[...jobs.values()].filter(j=>['queued','running'].includes(j.status)).length>=20)throw new VideoServiceError('待处理任务过多，请稍后重试。',429,'BUSY');
          const job={id,sessionId:body.sessionId,videoId:body.videoId,version:body.version,kind:body.kind,status:cancelled.has(id)?'cancelled':'queued',result:null,error:''};jobs.set(id,job);send(response,202,{job:snapshot(job)});schedule();return true;
        }
        const match=route.match(/^\/jobs\/(vj_[a-f0-9-]{36})(\/cancel)?$/);
        if(match){if(match[2]&&method==='POST'){cancel(match[1]);send(response,200,{cancelled:true});return true;}if(!match[2]&&method==='GET'){const job=jobs.get(match[1]);if(!job)throw new VideoServiceError('任务不存在或已清理。',404);get(job.sessionId);send(response,200,{job:snapshot(job)});return true;}}
        throw new VideoServiceError('接口不存在或方法不正确。',404,'NOT_FOUND');
      }catch(error){send(response,error instanceof VideoServiceError?error.status:500,{error:{code:error instanceof VideoServiceError?error.code:'INTERNAL_ERROR',message:error instanceof VideoServiceError?error.message:'当前视频分析未完成，请重试。'},requestId});return true;}
    }
  };
}
