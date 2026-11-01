const refundBackendPath='/api/v1/image/refund';
export function createRefundBackend({getImages,request=fetch}) {
  const hashes=new WeakMap(),pendingIds=new Set();let current=null,signature='',generation=0,disposed=false;
  async function call(route,{method='GET',body,signal}={}) {
    const response=await request(refundBackendPath+route,{method,signal,headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    const result=await response.json();
    if(!response.ok){const error=new Error(result.error?.message||`服务返回 HTTP ${response.status}`);error.httpStatus=response.status;throw error;}
    return result;
  }
  function close(id){if(id)void request(refundBackendPath+'/sessions/'+id+'/close',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json'},body:'{}'}).catch(()=>{});}
  function reset(){generation++;close(current?.id);for(const id of pendingIds)close(id);pendingIds.clear();current=null;signature='';}
  async function fingerprint(file){if(!hashes.has(file))hashes.set(file,crypto.subtle.digest('SHA-256',await file.arrayBuffer()).then(value=>Array.from(new Uint8Array(value),b=>b.toString(16).padStart(2,'0')).join('')));return hashes.get(file);}
  async function encode(file){const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return {name:file.name,type:file.type,data:btoa(binary)};}
  async function prepare(fields,files,signal){
    const version=generation;
    const next=JSON.stringify({fields,files:await Promise.all(files.map(async file=>({name:file.name,hash:await fingerprint(file)})))});
    if(disposed || version!==generation || signal?.aborted)throw new DOMException('操作已取消','AbortError');
    if(next===signature && current)return current;
    close(current?.id);current=null;signature='';
    const id='c_'+crypto.randomUUID().replaceAll('-','').slice(0,24);pendingIds.add(id);
    try{
      const result=await call('/sessions',{method:'POST',body:{id,fields,files:await Promise.all(files.map(encode))},signal});
      if(disposed || version!==generation || signal?.aborted)throw new DOMException('操作已取消','AbortError');
      current=result.session;signature=next;return current;
    }catch(error){close(id);throw error;}finally{pendingIds.delete(id);}
  }
  async function run(kind,{fields,image},{signal}){
    const images=getImages(),index=images.findIndex(i=>i.file===image.file);
    if(index<0)throw new Error('图片与当前材料不匹配。');
    let item=await prepare(fields,images.map(i=>i.file),signal),id='j_'+crypto.randomUUID();
    const cancel=()=>{void call(`/jobs/${id}/cancel`,{method:'POST',signal:AbortSignal.timeout(5000)}).catch(()=>{});};
    signal.addEventListener('abort',cancel,{once:true});
    try{
      signal.throwIfAborted();
      let job;
      try{({job}=await call('/jobs',{method:'POST',body:{id,sessionId:item.id,imageId:item.images[index].id,kind},signal}));}
      catch(error){
        if(error.httpStatus!==404 || signal.aborted || disposed)throw error;
        reset();item=await prepare(fields,images.map(i=>i.file),signal);id='j_'+crypto.randomUUID();
        ({job}=await call('/jobs',{method:'POST',body:{id,sessionId:item.id,imageId:item.images[index].id,kind},signal}));
      }
      while(['queued','running'].includes(job.status)){
        await new Promise((resolve,reject)=>{
          const abort=()=>{clearTimeout(timer);reject(new DOMException('检测已取消','AbortError'));};
          const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},750);
          signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
        });
        ({job}=await call('/jobs/'+id,{signal}));
      }
      if(job.status!=='succeeded')throw new Error(job.error||'检测未完成，请重试。');
      return {...job.result,imageId:image.id};
    }finally{signal.removeEventListener('abort',cancel);if(signal.aborted)cancel();}
  }
  return {status:()=>call('/status'),reset,dispose(){disposed=true;reset();},
    async submit({fields,files},{signal}){const item=await prepare(fields,files,signal);return {accepted:true,receiptId:item.id};},
    handlers:{ai:(input,options)=>run('ai',input,options),tamper:(input,options)=>run('tamper',input,options),comparison:(input,options)=>run('comparison',input,options)}
  };
}
