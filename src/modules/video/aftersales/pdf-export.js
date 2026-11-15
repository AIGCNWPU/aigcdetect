import { loadRefundPdfRuntime,prepareRefundPdfMask } from '../../image/refund/pdf-export.js';
import { formatRefundPdfTime } from '../../image/refund/pdf-report.js';
import { buildCurrentVideoReport,createCurrentVideoPdf } from './pdf-report.js';

function videoPdfWaitMedia(video,event,action,signal){
  return new Promise((resolve,reject)=>{
    const cleanup=()=>{clearTimeout(timer);video.removeEventListener(event,done);video.removeEventListener('error',error);signal?.removeEventListener('abort',abort);};
    const done=()=>{cleanup();resolve();},error=()=>{cleanup();reject(new Error('视频画面无法读取，未能生成报告。'));},abort=()=>{cleanup();reject(new DOMException('操作已取消','AbortError'));};
    const timer=setTimeout(()=>{cleanup();reject(new Error('视频画面读取超时，请重试。'));},15000);
    video.addEventListener(event,done,{once:true});video.addEventListener('error',error,{once:true});signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();else action();
  });
}
export async function prepareVideoPdfPreview(item,{signal}={}){
  signal?.throwIfAborted();const url=URL.createObjectURL(item.file),video=document.createElement('video'),canvas=document.createElement('canvas');
  video.preload='auto';video.muted=true;video.playsInline=true;
  try{
    await videoPdfWaitMedia(video,'loadeddata',()=>{video.src=url;video.load();},signal);
    if(video.videoWidth!==item.width||video.videoHeight!==item.height||!Number.isFinite(video.duration)||Math.abs(video.duration-item.duration)>.5)throw new Error('预览画面与当前视频尺寸或时长不一致。');
    const time=Math.max(0,Math.min(item.duration/2,video.duration-.05));
    if(Math.abs(video.currentTime-time)>.01)await videoPdfWaitMedia(video,'seeked',()=>{video.currentTime=time;},signal);
    signal?.throwIfAborted();const scale=Math.min(1,720/Math.max(item.width,item.height));canvas.width=Math.max(1,Math.round(item.width*scale));canvas.height=Math.max(1,Math.round(item.height*scale));
    canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('视频预览转换失败。')),'image/jpeg',.93));signal?.throwIfAborted();
    return {type:'image/jpeg',bytes:new Uint8Array(await blob.arrayBuffer()),width:canvas.width,height:canvas.height,time:video.currentTime};
  }finally{video.pause();video.removeAttribute('src');video.load();URL.revokeObjectURL(url);canvas.width=1;canvas.height=1;}
}
export async function prepareVideoPdfFrame(frame,{signal}={}){
  signal?.throwIfAborted();const data=frame.preview.dataUrl.split(',')[1],binary=atob(data),bytes=Uint8Array.from(binary,ch=>ch.charCodeAt(0));
  const overlay=frame.hasMark?await prepareRefundPdfMask(frame.mask,{signal}):undefined;signal?.throwIfAborted();
  return {type:'image/jpeg',bytes,width:frame.preview.width,height:frame.preview.height,...(overlay?{overlay}:{})};
}
export async function downloadCurrentVideoPdf(fields,entries,{signal,onProgress=()=>{}}={}){
  const report=buildCurrentVideoReport(fields,entries);onProgress({phase:'loading',completed:0,total:report.videos.length});
  const runtime=await loadRefundPdfRuntime();signal?.throwIfAborted();
  const bytes=await createCurrentVideoPdf(report,{...runtime,prepareFrame:prepareVideoPdfFrame,preparePreview:prepareVideoPdfPreview,signal,onProgress});
  await new Promise(resolve=>setTimeout(resolve,0));signal?.throwIfAborted();
  const safe=String(fields.caseNumber||'当前分析').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(0,80),url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
  const link=document.createElement('a');link.href=url;link.download=`售后视频分析报告-${safe}-${formatRefundPdfTime(report.generatedAt,{filename:true})}.pdf`;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
