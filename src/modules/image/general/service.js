import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {platformRoot,python,runLocal,selectGpu} from '../documents/server/local-runtime.js';
import {ReviewError} from '../documents/server/review-service.js';
const invalid=()=>{throw new ReviewError('INVALID_IMAGE','请选择有效的 JPG、PNG 或 WebP 图片。');};
export async function readImageExample(kind){
 try{return JSON.parse(await readFile(path.join(platformRoot,'runtime/public-examples',kind+'.json'),'utf8'));}
 catch{throw new ReviewError('EXAMPLE_UNAVAILABLE','示例暂未准备好。',503);}
}
export function validateGeneralRequest(p){
 if(p?.action!=='detect'||typeof p.id!=='string'||!/^[\w-]{1,80}$/.test(p.id))invalid();
 const f=p.file;if(!f||typeof f.name!=='string'||f.name.length>200||!['image/jpeg','image/png','image/webp'].includes(f.mediaType)||typeof f.contentBase64!=='string'||f.contentBase64.length>14*1024*1024||!f.contentBase64.length||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(f.contentBase64))invalid();
 const bytes=Buffer.from(f.contentBase64,'base64');if(!bytes.length||bytes.length>10*1024*1024)invalid();return bytes;
}
export function createGeneralService({runner=runLocal,gpuSelector=selectGpu,retryMs=15000,root=platformRoot}={}){
 const jobs=new Map(),queue=[];let busy=false;
 const updatePositions=()=>queue.forEach((entry,index)=>{entry.job.queuePosition=index+1;});
 async function drain(){
  if(busy||!queue.length)return;busy=true;
  const {job,dir,manifest,result}=queue[0];
  try{
   let gpu;
   while(gpu===undefined){
    try{gpu=await gpuSelector(dir,'dda');}
    catch(error){if(error.message!=='no_idle_gpu')throw error;job.summary='检测资源繁忙，正在排队等待，空闲后将自动开始。';await new Promise(resolve=>setTimeout(resolve,retryMs));}
   }
   job.status='running';job.queuePosition=0;job.summary='当前正在检测，请您耐心等待~';
   const executed=await runner(python('mirror-runtime'),['src/modules/image/general/analyze.py','--root',platformRoot,'--manifest',manifest,'--output',result,'--gpu',gpu],{log:path.join(dir,'process.log'),timeout:300000});
   if(executed.code!==0)throw new Error('inference_failed');
   const rows=JSON.parse(await readFile(result,'utf8'));
   if(rows[0]?.status!=='completed')throw new Error('decode_or_inference_failed');
   Object.assign(job,rows[0]);
  }catch{Object.assign(job,{status:'failed',reason:'analysis_failed',summary:'本次图片分析未能完成，请确认图片或稍后重试。'});}
  finally{queue.shift();updatePositions();busy=false;setImmediate(drain);}
 }

 return async p=>{
  if(p?.action==='example')return readImageExample('general');
  if(p?.action==='status'){
   const job=jobs.get(p.jobId);if(!job)throw new ReviewError('JOB_NOT_FOUND','检测任务不存在。',404);return structuredClone(job);
  }
  const bytes=validateGeneralRequest(p);
  if(queue.length>=1000)throw new ReviewError('QUEUE_FULL','等待任务较多，请稍后提交。',429);
  const jobId=randomUUID(),job={id:p.id,jobId,status:'queued',summary:'已加入检测队列，请耐心等待。'};
  const dir=path.join(root,'runtime/reviews/general',jobId);
  await mkdir(dir,{recursive:true,mode:0o700});
  const file=path.join(dir,'input'+({'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp'}[p.file.mediaType]));
  await writeFile(file,bytes,{flag:'wx',mode:0o600});
  const manifest=path.join(dir,'manifest.json'),result=path.join(dir,'result.json');
  await writeFile(manifest,JSON.stringify([{id:p.id,path:file}]),{flag:'wx',mode:0o600});
  jobs.set(jobId,job);queue.push({job,dir,manifest,result});updatePositions();setImmediate(drain);
  if(jobs.size>1100)for(const [key,value] of jobs)if(!['queued','running'].includes(value.status)){jobs.delete(key);break;}
  return structuredClone(job);
 };
}
export const runGeneralReview=createGeneralService();
