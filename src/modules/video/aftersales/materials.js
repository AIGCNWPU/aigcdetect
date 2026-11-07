export const aftersalesVideoLimits=Object.freeze({count:5,bytes:200*1024*1024,seconds:600,readTimeout:15000});
export const aftersalesVideoFieldLimits=Object.freeze({caseNumber:100,productName:200,style:200,productInfo:2000,description:2000});

export function validateAftersalesVideoFields(fields) {
  const labels={caseNumber:'案件编号',productName:'商品名称',style:'商品款式',productInfo:'商品资料',description:'问题描述'},errors={};
  for(const [key,max] of Object.entries(aftersalesVideoFieldLimits)) {
    const value=String(fields?.[key]??'').trim();
    if(['caseNumber','productName','description'].includes(key)&&!value) errors[key]=`请填写${labels[key]}。`;
    else if(value.length>max) errors[key]=`${labels[key]}不能超过 ${max} 个字符。`;
  }
  return errors;
}

export function validateAftersalesVideoFile(file) {
  const extension=file.name?.split('.').pop().toLowerCase();
  if(!['mp4','webm'].includes(extension)||(file.type&&file.type!==`video/${extension}`)) return '请选择 MP4 或 WebM 视频。';
  if(!Number.isFinite(file.size)||file.size<=0) return '文件为空或大小无效。';
  if(file.size>aftersalesVideoLimits.bytes) return '单个视频不能超过 200 MiB。';
  return null;
}

export function validateAftersalesVideoMetadata(value) {
  if(!Number.isFinite(value.duration)||value.duration<=0) return '无法读取有效视频时长，请选择完整视频文件。';
  if(value.duration>aftersalesVideoLimits.seconds) return '视频时长不能超过 10 分钟。';
  if(!Number.isFinite(value.width)||!Number.isFinite(value.height)||value.width<=0||value.height<=0) return '无法读取有效视频画面。';
  return null;
}

async function hasAftersalesVideoSignature(file,isCancelled) {
  const extension=file.name.split('.').pop().toLowerCase();
  if(extension==='mp4'){
    // Top-level boxes may precede ftyp; skip their payload without loading the video into memory.
    let offset=0;
    for(let index=0;index<64&&offset+8<=file.size;index++){
      const buffer=await file.slice(offset,offset+16).arrayBuffer();if(isCancelled())return false;
      if(buffer.byteLength<8)return false;
      const view=new DataView(buffer),bytes=new Uint8Array(buffer),type=String.fromCharCode(...bytes.slice(4,8));
      let size=view.getUint32(0),header=8;
      if(size===1){if(buffer.byteLength<16)return false;size=Number(view.getBigUint64(8));header=16;}
      if(size===0)size=file.size-offset;
      if(!Number.isSafeInteger(size)||size<header||size>file.size-offset)return false;
      if(type==='ftyp')return size>=header+8&&(size-header)%4===0;
      offset+=size;
    }
    return false;
  }
  const bytes=new Uint8Array(await file.slice(0,65536).arrayBuffer());if(isCancelled())return false;
  if(bytes[0]!==0x1a||bytes[1]!==0x45||bytes[2]!==0xdf||bytes[3]!==0xa3)return false;
  const integer=(offset,keepMarker=false)=>{
    const first=bytes[offset];if(!first)return null;
    let length=1,mask=128;while(!(first&mask)){length++;mask>>=1;}
    if(length>8||offset+length>bytes.length)return null;
    let value=keepMarker?first:first&(mask-1);
    for(let index=1;index<length;index++)value=value*256+bytes[offset+index];
    return Number.isSafeInteger(value)?{value,length}:null;
  };
  const header=integer(4);if(!header)return false;
  const end=4+header.length+header.value;if(end>bytes.length)return false;
  let offset=4+header.length;
  while(offset<end){
    const id=integer(offset,true);if(!id)return false;offset+=id.length;
    const size=integer(offset);if(!size)return false;offset+=size.length;
    if(offset+size.value>end)return false;
    if(id.value===0x4282)return size.value===4&&String.fromCharCode(...bytes.slice(offset,offset+4))==='webm';
    offset+=size.value;
  }
  return false;
}

/** Read only a small signature and the first decodable frame; never upload or transcode. */
export function readAftersalesVideo(file,{signal,timeout=aftersalesVideoLimits.readTimeout}={}) {
  return new Promise((resolve,reject)=>{
    let video=null,url=null,settled=false;
    const finish=(error,value)=>{
      if(settled) return;
      settled=true; clearTimeout(timer); signal?.removeEventListener('abort',abort);
      if(video){video.onloadedmetadata=null;video.onloadeddata=null;video.onerror=null;video.pause();video.removeAttribute('src');video.load();}
      if(error){if(url) URL.revokeObjectURL(url);reject(error);}else resolve(value);
    };
    const abort=()=>finish(new Error('视频读取已取消。'));
    const timer=setTimeout(()=>finish(new Error('视频读取超时，请检查文件后重试。')),timeout);
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted){abort();return;}
    hasAftersalesVideoSignature(file,()=>settled).then(valid=>{
      if(settled)return;
      if(!valid)throw new Error('文件内容与视频格式不符或文件已损坏。');
      url=URL.createObjectURL(file); video=document.createElement('video');
      video.preload='auto';video.muted=true;video.playsInline=true;
      const details=()=>({url,duration:video.duration,width:video.videoWidth,height:video.videoHeight});
      video.onloadedmetadata=()=>{const error=validateAftersalesVideoMetadata(details());if(error)finish(new Error(error));};
      video.onloadeddata=()=>{const value=details(),error=validateAftersalesVideoMetadata(value);finish(error?new Error(error):null,value);};
      video.onerror=()=>finish(new Error('视频无法解码，请选择完整且浏览器支持的视频。'));
      video.src=url;video.load();
    }).catch(error=>finish(error));
  });
}

export function createAftersalesVideoMaterials({readVideo=readAftersalesVideo,revoke=url=>URL.revokeObjectURL(url)}={}) {
  const items=[],controller=new AbortController();
  let sequence=0,disposed=false,queue=Promise.resolve();
  return {
    get items(){return items.slice();},
    add(files){
      const batch=Array.from(files);
      const operation=queue.then(async()=>{
        const errors=[];let added=0;
        for(const file of batch){
          if(disposed)break;
          const invalid=validateAftersalesVideoFile(file)||(items.length>=aftersalesVideoLimits.count?'每案最多添加 5 个视频。':null);
          if(invalid){errors.push({name:file.name,message:invalid});continue;}
          try{
            const value=await readVideo(file,{signal:controller.signal});
            if(disposed){revoke(value.url);break;}
            const error=validateAftersalesVideoMetadata(value);
            if(error){revoke(value.url);throw new Error(error);}
            items.push({id:`aftersales-video-${++sequence}`,file,...value});added++;
          }catch(error){if(!disposed)errors.push({name:file.name,message:error.message||'视频读取失败。'});}
        }
        return {added,errors};
      });
      queue=operation.catch(()=>{});return operation;
    },
    remove(id){const index=items.findIndex(item=>item.id===id);if(index>=0)revoke(items.splice(index,1)[0].url);},
    dispose(){if(disposed)return;disposed=true;controller.abort();for(const item of items.splice(0))revoke(item.url);},
  };
}
