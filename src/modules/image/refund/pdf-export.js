import { buildCurrentRefundReport,createCurrentRefundPdf,formatRefundPdfTime } from './pdf-report.js';
import { refundMaskRgba } from './localization.js';

const refundPdfAssets='./public/vendor/refund-pdf/';
let refundPdfRuntime;
function loadRefundPdfScript(file,globalName){
  if(globalThis[globalName])return Promise.resolve(globalThis[globalName]);
  return new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=new URL(refundPdfAssets+file,document.baseURI).href;script.onload=()=>globalThis[globalName]?resolve(globalThis[globalName]):reject(new Error('PDF 组件加载失败。'));script.onerror=()=>{script.remove();reject(new Error('PDF 组件读取失败，请重试。'));};document.head.append(script);});
}
async function loadRefundPdfRuntime(){
  if(!refundPdfRuntime)refundPdfRuntime=(async()=>{
    const [PDFLib,fontkit,response]=await Promise.all([loadRefundPdfScript('pdf-lib.min.js','PDFLib'),loadRefundPdfScript('fontkit.umd.min.js','fontkit'),fetch(new URL(refundPdfAssets+'NotoSansSC-Regular.ttf',document.baseURI))]);
    if(!response.ok)throw new Error('中文字体读取失败，请重试。');return {PDFLib,fontkit,fontBytes:new Uint8Array(await response.arrayBuffer())};
  })().catch(error=>{refundPdfRuntime=null;throw error;});
  return refundPdfRuntime;
}
async function prepareRefundPdfImage(image,{signal}={}){
  const url=URL.createObjectURL(image.file),element=new Image(),canvas=document.createElement('canvas');
  try{
    await new Promise((resolve,reject)=>{const abort=()=>{element.src='';reject(new DOMException('操作已取消','AbortError'));};element.onload=()=>{signal?.removeEventListener('abort',abort);resolve();};element.onerror=()=>{signal?.removeEventListener('abort',abort);reject(new Error('报告图片无法读取。'));};signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}element.src=url;});
    signal?.throwIfAborted();const scale=Math.min(1,1800/Math.max(element.naturalWidth,element.naturalHeight));
    canvas.width=Math.max(1,Math.round(element.naturalWidth*scale));canvas.height=Math.max(1,Math.round(element.naturalHeight*scale));
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(element,0,0,canvas.width,canvas.height);
    const encode=async()=>{const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('报告图片转换失败。')),'image/jpeg',.93));signal?.throwIfAborted();return {type:'image/jpeg',bytes:new Uint8Array(await blob.arrayBuffer()),width:canvas.width,height:canvas.height};};
    const original=await encode();
    const mask=image.states.tamper.mask;let overlay;
    if(mask){
      const layer=document.createElement('canvas');layer.width=mask.width;layer.height=mask.height;
      try{
        const context=layer.getContext('2d'),pixels=context.createImageData(mask.width,mask.height);
        pixels.data.set(refundMaskRgba(mask));
        context.putImageData(pixels,0,0);
        const blob=await new Promise((resolve,reject)=>layer.toBlob(value=>value?resolve(value):reject(new Error('局部标记转换失败。')),'image/png'));
        signal?.throwIfAborted();overlay={type:'image/png',bytes:new Uint8Array(await blob.arrayBuffer()),width:mask.width,height:mask.height};
      }finally{layer.width=1;layer.height=1;}
    }
    signal?.throwIfAborted();return {...original,...(overlay?{overlay}:{})};
  }finally{URL.revokeObjectURL(url);element.src='';canvas.width=1;canvas.height=1;}
}
export async function downloadCurrentRefundPdf(fields,entries,{signal,onProgress=()=>{}}={}){
  const report=buildCurrentRefundReport(fields,entries);onProgress({phase:'loading',completed:0,total:entries.length});const runtime=await loadRefundPdfRuntime();signal?.throwIfAborted();
  const bytes=await createCurrentRefundPdf(report,{...runtime,prepareImage:prepareRefundPdfImage,signal,onProgress});signal?.throwIfAborted();
  await new Promise(resolve=>setTimeout(resolve,0));signal?.throwIfAborted();
  const safe=String(fields.caseNumber||'当前分析').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(0,80);
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'})),link=document.createElement('a');link.href=url;link.download=`售后分析报告-${safe}-${formatRefundPdfTime(report.generatedAt,{filename:true})}.pdf`;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
