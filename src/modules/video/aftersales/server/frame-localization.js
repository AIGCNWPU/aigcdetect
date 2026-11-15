import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as wait } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import path from 'node:path';
import { inspectRefundImage } from '../../../image/refund/server/image-header.js';
import { decodeRefundMask } from '../../../image/refund/localization.js';
import { frameLocalizationProtocol,validateFrameLocalization } from '../frame-localization.js';

const execute=promisify(execFile),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=()=>{throw new Error('关键帧定位返回的图片关联、模型或掩码无效。');};
export function selectLocalizationFrames(probe,duration){
  if(!Array.isArray(probe.frames)||!probe.frames.length||probe.frames.length>200000)fail();
  let previous=-Infinity;
  const visible=probe.frames.flatMap((frame,frameIndex)=>{
    const time=Number(frame.best_effort_timestamp_time);
    if(!Number.isFinite(time))fail();
    if(time<0||time>=duration)return [];
    if(time<=previous)fail();previous=time;
    return [{frameIndex,time}];
  });
  const count=Math.min(8,visible.length);if(!count)fail();
  return Array.from({length:count},(_,i)=>visible[Math.min(visible.length-1,Math.floor(visible.length*(i+.5)/count))]);
}

async function extractFrames(input,directory,signal){
  const {stdout}=await execute(process.env.VERITAS_FFPROBE||'ffprobe',['-v','error','-select_streams','v:0','-show_frames','-show_entries','frame=best_effort_timestamp_time','-of','json',input.path],{signal,timeout:90000,maxBuffer:24*1024*1024});
  const frames=selectLocalizationFrames(JSON.parse(stdout),input.video.duration);
  const select=frames.map(frame=>`eq(n,${frame.frameIndex})`).join('+');
  await execute(process.env.VERITAS_FFMPEG||'ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-threads','2','-i',input.path,'-map','0:v:0','-an','-vf',`select='${select}'`,'-fps_mode','vfr','-frames:v',String(frames.length),'-pix_fmt','rgb24','-threads','2',path.join(directory,'frame-%02d.png')],{signal,timeout:90000,maxBuffer:1024*1024});
  return frames;
}

async function inferFrame(service,bytes,input,signal,request){
  const dimensions=inspectRefundImage(bytes,'image/png');
  if(bytes.length>12*1024*1024||dimensions.width!==input.video.width||dimensions.height!==input.video.height)fail();
  let response;
  for(let attempt=0;;attempt++){
    signal.throwIfAborted();
    response=await request(service.url.replace(/\/$/,'')+'/v1/localize',{method:'POST',headers:{Authorization:`Bearer ${service.token}`,'Content-Type':'image/png'},body:bytes,signal:AbortSignal.any([signal,AbortSignal.timeout(90000)])});
    if(response.status!==429||attempt>=3)break;
    await response.body?.cancel();await wait(750*(attempt+1),undefined,{signal});
  }
  if(!response.ok){await response.body?.cancel();throw new Error('局部检测服务未返回有效结果。');}
  const chunks=[];let length=0;
  for await(const chunk of response.body){length+=chunk.length;if(length>200000){await response.body.cancel().catch(()=>{});fail();}chunks.push(chunk);}
  const raw=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(raw.status!=='succeeded'||raw.provider!=='FLAME'||raw.model!=='FLAME-v0.1.0-LADMulti-SAM2'||raw.source_commit!=='5d3d42f32934d64a898fd4fd05a815a9a3e32ebf'||raw.checkpoint_sha256!=='9b6c67e3c35f647a3c9207275b1f1406c36780a2a3e0ee6b0f696d82161991bb'||raw.input?.sha256!==sha(bytes)||raw.input?.exif_orientation!==1||raw.input?.stored_size?.length!==2||raw.input?.oriented_size?.length!==2||raw.input.stored_size[0]!==dimensions.width||raw.input.stored_size[1]!==dimensions.height||raw.input.oriented_size.some((n,i)=>n!==raw.input.stored_size[i])||raw.localization_supported!==true||raw.mask_threshold!==.5||raw.mask?.width!==512||raw.mask?.height!==512)fail();
  const bits=decodeRefundMask(raw.mask);
  return {width:dimensions.width,height:dimensions.height,pngSha256:sha(bytes),mask:raw.mask,markedPixels:bits.reduce((sum,b)=>sum+b,0)};
}

async function previewFrame(filename,signal){
  const {stdout}=await execute(process.env.VERITAS_FFMPEG||'ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-threads','2','-i',filename,'-frames:v','1','-vf','scale=720:720:force_original_aspect_ratio=decrease:force_divisible_by=2','-q:v','5','-threads','2','-f','image2pipe','-vcodec','mjpeg','pipe:1'],{signal,encoding:'buffer',timeout:15000,maxBuffer:600000});
  const {width,height}=inspectRefundImage(stdout,'image/jpeg');
  return {width,height,dataUrl:'data:image/jpeg;base64,'+stdout.toString('base64')};
}

export async function localizeVideoFrames(config,input,analysis,signal,request=fetch){
  const base={protocol:frameLocalizationProtocol,inputSha256:input.sha256,trigger:analysis.policies.complementary,frames:[]};
  const finish=value=>validateFrameLocalization({...base,...value},input.video,analysis);
  if(base.trigger!=='review')return finish({status:base.trigger==='incomplete'?'source_incomplete':'not_triggered'});
  if(!config?.url||!config?.token)return finish({status:'unavailable',error:'关键帧局部检测服务尚未配置，本次未执行。'});
  let directory;
  try{
    signal.throwIfAborted();
    directory=await mkdtemp(path.join(path.dirname(input.path),'frame-localization-'));
    const selected=await extractFrames(input,directory,signal),frames=[];
    for(const [index,frame] of selected.entries()){
      signal.throwIfAborted();
      try{
        const filename=path.join(directory,`frame-${String(index+1).padStart(2,'0')}.png`),bytes=await readFile(filename);
        const inference=await inferFrame(config,bytes,input,signal,request),preview=await previewFrame(filename,signal);
        frames.push({...frame,status:'succeeded',...inference,preview});
      }catch(error){signal.throwIfAborted();frames.push({...frame,status:'failed',error:'该画面未取得有效局部定位结果，请重试。'});}
    }
    if(!frames.some(frame=>frame.status==='succeeded'))return finish({status:'failed',error:'关键帧局部定位未取得有效结果；已保留来源检测依据。'});
    return finish({status:frames.every(frame=>frame.status==='succeeded')?'localized':'partial',frames});
  }catch(error){signal.throwIfAborted();return finish({status:'failed',error:'原视频抽帧或局部定位失败；已保留来源检测依据，可重试。'});}
  finally{if(directory)await rm(directory,{recursive:true,force:true});}
}
