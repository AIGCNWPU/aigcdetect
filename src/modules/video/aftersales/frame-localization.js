import { decodeRefundMask } from '../../image/refund/localization.js';

export const frameLocalizationProtocol='flame-keyframes-v1';
export function validateFrameLocalization(value,video,analysis){
  const fail=()=>{throw new Error('关键帧定位结果、时间或掩码与当前视频不一致。');};
  const text=(v,max=500)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
  const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
  const decision=analysis?.policies.complementary;
  if(!value||value.protocol!==frameLocalizationProtocol||!digest(value.inputSha256)||value.trigger!==decision||!Array.isArray(value.frames)||value.frames.length>8)fail();
  const result={protocol:frameLocalizationProtocol,inputSha256:value.inputSha256,trigger:decision,status:value.status};
  const skipped={not_triggered:'not_triggered',source_incomplete:'incomplete'};
  if(Object.hasOwn(skipped,value.status)){
    if(decision!==skipped[value.status]||value.frames.length)fail();
    return Object.freeze({...result,frames:Object.freeze([])});
  }
  if(decision!=='review')fail();
  if(['unavailable','failed'].includes(value.status)){
    if(value.frames.length||!text(value.error))fail();
    return Object.freeze({...result,error:value.error,frames:Object.freeze([])});
  }
  if(!['localized','partial'].includes(value.status)||!value.frames.length)fail();
  let previous=-1,index=-1;
  const frames=value.frames.map(frame=>{
    if(!frame||!Number.isInteger(frame.frameIndex)||frame.frameIndex<=index||frame.frameIndex>=200000||!Number.isFinite(frame.time)||frame.time<=previous||frame.time<0||frame.time>=video.duration)fail();
    previous=frame.time;index=frame.frameIndex;
    const identity={frameIndex:frame.frameIndex,time:frame.time,status:frame.status};
    if(frame.status==='failed'){
      if(!text(frame.error)||frame.mask!==undefined||frame.preview!==undefined)fail();
      return Object.freeze({...identity,error:frame.error});
    }
    if(frame.status!=='succeeded'||frame.width!==video.width||frame.height!==video.height||!digest(frame.pngSha256)||!Number.isInteger(frame.markedPixels)||frame.mask?.width!==512||frame.mask?.height!==512)fail();
    const preview=frame.preview;
    if(!preview||!Number.isInteger(preview.width)||!Number.isInteger(preview.height)||Math.min(preview.width,preview.height)<1||Math.max(preview.width,preview.height)>720||Math.abs(preview.width*frame.height-preview.height*frame.width)>2*Math.max(frame.width,frame.height)||typeof preview.dataUrl!=='string'||preview.dataUrl.length>850000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(preview.dataUrl))fail();
    const bits=decodeRefundMask(frame.mask);
    if(frame.markedPixels!==bits.reduce((sum,b)=>sum+b,0))fail();
    return Object.freeze({...identity,width:frame.width,height:frame.height,pngSha256:frame.pngSha256,markedPixels:frame.markedPixels,mask:Object.freeze({...frame.mask}),preview:Object.freeze({...preview})});
  });
  const successes=frames.filter(frame=>frame.status==='succeeded').length;
  if(!successes||(value.status==='localized')!==(successes===frames.length))fail();
  return Object.freeze({...result,frames:Object.freeze(frames)});
}

export function frameLocalizationIncomplete(value){return value&&['failed','partial','source_incomplete','unavailable'].includes(value.status);}
