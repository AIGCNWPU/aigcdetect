import { aftersalesProductKinds } from './detection.js';
const videoBackendPath='/api/v1/video/aftersales';
export function createAftersalesBackend({getVideos,request=fetch}){
  let current=null,signature='',generation=0,disposed=false;const pending=new Set(),identities=new WeakMap();let identity=0;
  const key=file=>{if(!identities.has(file))identities.set(file,++identity);return identities.get(file);};
  async function call(route,{method='GET',body,signal,file}={}){
    const response=await request(videoBackendPath+route,{method,signal,headers:{Accept:'application/json',...(file?{'Content-Type':file.type||`video/${file.name.split('.').pop().toLowerCase()}`} : body?{'Content-Type':'application/json'}:{})},body:file|| (body?JSON.stringify(body):undefined)});
    const result=await response.json();if(!response.ok){const error=new Error(result.error?.message||`服务返回 HTTP ${response.status}`);error.httpStatus=response.status;throw error;}return result;
    }
  function close(id){if(id)void request(videoBackendPath+'/sessions/'+id+'/close',{method:'POST',keepalive:true}).catch(()=>{});}
  function reset(){generation++;close(current?.id);for(const id of pending)close(id);pending.clear();current=null;signature='';}
  async function prepare(fields,videos,signal){
    signal?.throwIfAborted();if(disposed)throw new Error('页面已关闭。');
    const revision=generation,next=JSON.stringify({fields,videos:videos.map(v=>({id:v.id,version:v.version,file:key(v.file)}))});
    if(current&&signature===next)return current;
    close(current?.id);current=null;signature='';const id='v_'+crypto.randomUUID();pending.add(id);
    try{
      const body={id,fields,videos:videos.map(v=>({id:v.id,version:v.version,type:v.file.type||`video/${v.file.name.split('.').pop().toLowerCase()}`,size:v.file.size,duration:v.duration,width:v.width,height:v.height}))};
      const result=await call('/sessions',{method:'POST',body,signal});
      for(const video of videos){
        if(disposed||generation!==revision)throw new Error('材料已变化，请重新提交。');
        await call(`/sessions/${id}/videos/${video.id}`,{method:'PUT',file:video.file,signal});
      }
      signal?.throwIfAborted();if(disposed||generation!==revision)throw new Error('材料已变化，请重新提交。');
      current=result.session;signature=next;return current;
    }catch(error){close(id);throw error;}finally{pending.delete(id);}
  }
  async function run(kind,{fields,video},{signal}){
    const videos=getVideos();if(!videos.some(v=>v.id===video.id&&v.version===video.version&&v.file===video.file))throw new Error('视频与当前材料不匹配。');
    let session=await prepare(fields,videos,signal),id='vj_'+crypto.randomUUID();
    const cancel=()=>{void call(`/jobs/${id}/cancel`,{method:'POST',signal:AbortSignal.timeout(5000)}).catch(()=>{});};
    signal.addEventListener('abort',cancel,{once:true});
    try{
      signal.throwIfAborted();let job;
      try{({job}=await call('/jobs',{method:'POST',body:{id,sessionId:session.id,videoId:video.id,version:video.version,kind},signal}));}
      catch(error){if(error.httpStatus!==410||disposed||signal.aborted)throw error;reset();session=await prepare(fields,videos,signal);id='vj_'+crypto.randomUUID();({job}=await call('/jobs',{method:'POST',body:{id,sessionId:session.id,videoId:video.id,version:video.version,kind},signal}));}
      while(['queued','running'].includes(job.status)){
        await new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(new DOMException('检测已取消','AbortError'));},timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},750);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
        ({job}=await call('/jobs/'+id,{signal}));
      }
      if(job.sessionId!==session.id||job.videoId!==video.id||job.version!==video.version||job.kind!==kind)throw new Error('返回任务与当前视频不匹配。');
      if(job.status!=='succeeded')throw new Error(job.error||'检测未完成，请重试。');return job.result;
    }finally{signal.removeEventListener('abort',cancel);if(signal.aborted)cancel();}
  }
  return {status:()=>call('/status'),reset,dispose(){disposed=true;reset();},async submit({fields},{signal}){const value=await prepare(fields,getVideos(),signal);return {accepted:true,receiptId:value.id};},handlers:Object.fromEntries(aftersalesProductKinds.map(kind=>[kind,(input,options)=>run(kind,input,options)]))};
}
