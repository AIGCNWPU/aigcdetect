import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { RefundSessionStore } from './store.js';
import { createRefundProviders, RefundServiceError } from './providers.js';

export function loadRefundConfig() {
  const filename=process.env.VERITAS_REFUND_CONFIG||path.join(os.homedir(),'.config/veritas/image-refund.json');
  try{return JSON.parse(readFileSync(filename,'utf8'));}
  catch(error){if(error.code==='ENOENT')return {};throw new Error('图片售后服务配置无法读取，请检查配置文件格式。');}
}
const refundApiRoot='/api/v1/image/refund';
const send=(response,status,data,headers={})=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});response.end(JSON.stringify(data));};
function refundRouteMethod(route){
  if(route==='/status' || /^\/jobs\/j_[a-f0-9-]{36}$/.test(route))return 'GET';
  if(['','/sessions','/jobs'].includes(route) || /^\/sessions\/c_[a-f0-9]{24}\/close$/.test(route) || /^\/jobs\/j_[a-f0-9-]{36}\/cancel$/.test(route))return 'POST';
  return null;
}
async function readPayload(request) {
  if(!request.headers['content-type']?.startsWith('application/json'))throw new RefundServiceError('请使用 JSON 请求。',415,'UNSUPPORTED_MEDIA_TYPE');
  const max=72*1024*1024;
  if(Number(request.headers['content-length'])>max)throw new RefundServiceError('请求超过 72 MiB。',413,'BODY_TOO_LARGE');
  let size=0;const chunks=[];
  for await(const chunk of request){size+=chunk.length;if(size>max)throw new RefundServiceError('请求超过 72 MiB。',413,'BODY_TOO_LARGE');chunks.push(chunk);}
  try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value || Array.isArray(value) || typeof value!=='object')throw new Error();return value;}catch{throw new RefundServiceError('请求 JSON 无效。');}
}

export function createRefundApi({config=loadRefundConfig(),providers=createRefundProviders(config),sessionOptions={}}={}) {
  const store=new RefundSessionStore(sessionOptions),jobs=new Map(),controllers=new Map(),activeKinds=new Set(),cancelled=new Set(),closedSessions=new Set();
  let closed=false,uploads=0;
  const remember=(set,id)=>{set.add(id);if(set.size>1000)set.delete(set.values().next().value);};
  function cancel(id){
    remember(cancelled,id);const job=jobs.get(id);
    if(job && ['queued','running'].includes(job.status)) {job.status='cancelled';job.result=null;job.error='检测已取消。';job.finishedAt=new Date().toISOString();controllers.get(id)?.abort();}
    return job||{id,status:'cancelled'};
  }
  function closeSession(id){
    remember(closedSessions,id);
    for(const job of jobs.values())if(job.sessionId===id){cancel(job.id);jobs.delete(job.id);}
    store.delete(id);
  }
  function sweep(){for(const id of store.expiredIds())closeSession(id);}
  const timer=setInterval(sweep,Math.min(60000,Math.max(100,store.ttlMs)));timer.unref();
  function schedule(){
    if(closed)return;
    for(const job of jobs.values()){
      if(job.status!=='queued' || activeKinds.has(job.kind))continue;
      if(job.kind==='tamper' && [...jobs.values()].some(other=>other.kind==='ai' && other.sessionId===job.sessionId && other.imageId===job.imageId && ['queued','running'].includes(other.status)))continue;
      activeKinds.add(job.kind);const controller=new AbortController();controllers.set(job.id,controller);
      void (async()=>{
        try{
          job.status='running';job.startedAt=new Date().toISOString();
          const input=store.image(job.sessionId,job.imageId);
          if(job.kind==='tamper')input.sourceResult=[...jobs.values()].filter(other=>other.kind==='ai' && other.sessionId===job.sessionId && other.imageId===job.imageId && other.status==='succeeded').at(-1)?.result;
          const result=await providers.run(job.kind,input,AbortSignal.any([controller.signal,AbortSignal.timeout(100000)]));
          if(job.status!=='running' || !store.has(job.sessionId) || jobs.get(job.id)!==job)return;
          job.result=result;job.status='succeeded';
        }catch(error){
          if(job.status!=='running' || jobs.get(job.id)!==job)return;
          job.status='failed';job.error=error instanceof RefundServiceError?error.message:'检测失败或超时，请重试。';job.errorCode=error.code||'DETECTION_FAILED';
        }finally{job.finishedAt=new Date().toISOString();controllers.delete(job.id);activeKinds.delete(job.kind);schedule();}
      })();
    }
  }
  return {
    async close(){closed=true;clearInterval(timer);for(const id of [...store.records.keys()])closeSession(id);store.clear();jobs.clear();},
    async handle(request,response,pathname,requestId){
      if(pathname!==refundApiRoot && !pathname.startsWith(refundApiRoot+'/'))return false;
      try{
        const host=request.headers.host||'',origin=request.headers.origin;
        if(!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host) || (origin && origin!==`http://${host}`) || request.headers['sec-fetch-site']==='cross-site')throw new RefundServiceError('只允许本机页面访问分析服务。',403,'ORIGIN_FORBIDDEN');
        sweep();const route=pathname.slice(refundApiRoot.length),method=request.method;
        const allowed=refundRouteMethod(route);
        if(allowed && method!==allowed){send(response,405,{error:{code:'METHOD_NOT_ALLOWED',message:`请使用 ${allowed}`},requestId},{Allow:allowed});return true;}
        if(route==='/status' && method==='GET'){send(response,200,{version:2,storage:'memory',capabilities:providers.capabilities});return true;}
        if((route==='' || route==='/sessions') && method==='POST'){
          if(uploads>=2)throw new RefundServiceError('正在处理其他材料，请稍后重试。',429,'BUSY');
          uploads++;
          try{
            const payload=await readPayload(request);
            if(closedSessions.has(payload.id))throw new RefundServiceError('本次分析已关闭。',409,'SESSION_CLOSED');
            const session=store.save(payload);send(response,200,{accepted:true,receiptId:session.id,session,requestId});
          }finally{uploads--;}
          return true;
        }
        const closeMatch=route.match(/^\/sessions\/(c_[a-f0-9]{24})\/close$/);
        if(closeMatch && method==='POST'){closeSession(closeMatch[1]);send(response,200,{closed:true});return true;}
        if(route==='/jobs' && method==='POST'){
          const body=await readPayload(request),id=body.id||'j_'+randomUUID();
          if(!/^j_[a-f0-9-]{36}$/.test(id)||!['ai','tamper','comparison'].includes(body.kind))throw new RefundServiceError('任务类型或编号无效。');
          if(!providers.capabilities[body.kind])throw new RefundServiceError('该检测能力尚未配置。',503,'NOT_CONFIGURED');
          store.image(body.sessionId,body.imageId);
          const existing=jobs.get(id);
          if(existing){if(existing.sessionId!==body.sessionId || existing.imageId!==body.imageId || existing.kind!==body.kind)throw new RefundServiceError('任务编号与材料不匹配。',409,'TASK_CONFLICT');send(response,200,{job:existing});return true;}
          if(jobs.size>=1000 || [...jobs.values()].filter(job=>['queued','running'].includes(job.status)).length>=30)throw new RefundServiceError('待处理任务过多，请稍后重试。',429,'BUSY');
          const job={id,sessionId:body.sessionId,imageId:body.imageId,kind:body.kind,status:cancelled.has(id)?'cancelled':'queued',createdAt:new Date().toISOString(),result:null,error:''};
          jobs.set(id,job);send(response,202,{job});schedule();return true;
        }
        const jobMatch=route.match(/^\/jobs\/(j_[a-f0-9-]{36})(\/cancel)?$/);
        if(jobMatch){
          if(jobMatch[2] && method==='POST'){send(response,200,{job:cancel(jobMatch[1])});return true;}
          if(!jobMatch[2] && method==='GET'){const job=jobs.get(jobMatch[1]);if(!job)throw new RefundServiceError('本次任务不存在或已结束。',404,'NOT_FOUND');store.get(job.sessionId);send(response,200,{job});return true;}
        }
        throw new RefundServiceError('接口不存在或请求方法不正确。',404,'NOT_FOUND');
      }catch(error){send(response,error instanceof RefundServiceError?error.status:500,{error:{code:error instanceof RefundServiceError?error.code:'INTERNAL_ERROR',message:error instanceof RefundServiceError?error.message:'当前分析服务处理失败。'},requestId});return true;}
    }
  };
}
