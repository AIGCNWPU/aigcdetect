import { videoReviewDetailSkipReason, validateVideoReview } from './source-review.js';
import { frameLocalizationIncomplete } from './frame-localization.js';
// Independent source scores; combined review never represents a forgery probability.
export const videoSourceDefinitions=Object.freeze({
  video:Object.freeze({label:'视频片段来源',threshold:.5,maxSamples:72}),
  keyframes:Object.freeze({label:'关键画面来源',threshold:.35755555331707006,maxSamples:8}),
});
export const videoDetailDefinition=Object.freeze({label:'画面细节复核',threshold:.824063926935196,guard:.2163227200508118,protocol:'uniform-8-native-center-context-v1'});
export function videoDetailSkipReason(channels){
  if(Object.values(channels).some(c=>c.triggered))return 'baseline_triggered';
  if(channels.keyframes.status!=='succeeded')return 'context_unavailable';
  if(channels.keyframes.score<videoDetailDefinition.guard)return 'context_below_guard';
  return null;
}
function validateDetail(item,channels,duration,video,fail,multiFrame=false){
  if(!item||typeof item!=='object'||Array.isArray(item))fail();
  const reason=multiFrame?videoReviewDetailSkipReason(channels):videoDetailSkipReason(channels);
  if(reason){
    if(item.status!=='skipped'||item.reason!==reason||item.score!==undefined||item.triggered!==undefined)fail();
    return Object.freeze({status:'skipped',reason});
  }
  if(item.status==='failed'){
    if(item.score!==undefined||item.triggered!==undefined||typeof item.error!=='string'||!item.error.trim()||item.error.length>500)fail();
    return Object.freeze({status:'failed',error:item.error});
  }
  if(item.status!=='succeeded'||!Number.isFinite(item.score)||item.score<0||item.score>1||item.threshold!==videoDetailDefinition.threshold||item.guard!==videoDetailDefinition.guard||item.sampleCount!==8||!Array.isArray(item.frames)||item.frames.length!==8)fail();
  const {width,height}=item;
  if(!Number.isInteger(width)||!Number.isInteger(height)||Math.min(width,height)<32||Math.max(width,height)>4096||width*height>9000000||video&&(width!==video.width||height!==video.height))fail();
  const cw=Math.min(504,width),ch=Math.min(504,height),left=Math.floor((width-cw)/2),top=Math.floor((height-ch)/2),box=[left,top,left+cw,top+ch];
  let previous=-1,index=-1;
  const frames=Object.freeze(item.frames.map(frame=>{
    if(!frame||!Number.isInteger(frame.frame_index)||frame.frame_index<=index||frame.frame_index>=200000||!Number.isFinite(frame.time)||frame.time<0||frame.time>=duration||frame.time<=previous||!Number.isFinite(frame.score)||frame.score<0||frame.score>1||typeof frame.frame_sha256!=='string'||!/^[a-f0-9]{64}$/.test(frame.frame_sha256)||!Array.isArray(frame.box)||frame.box.length!==4||frame.box.some((n,i)=>n!==box[i]))fail();
    previous=frame.time;index=frame.frame_index;
    return Object.freeze({frame_index:frame.frame_index,time:frame.time,score:frame.score,frame_sha256:frame.frame_sha256,box:Object.freeze([...box])});
  }));
  const sorted=frames.map(f=>f.score).sort((a,b)=>a-b),median=(sorted[3]+sorted[4])/2,triggered=median>=videoDetailDefinition.threshold&&(!multiFrame||channels.keyframes.score>=videoDetailDefinition.guard);
  if(Math.abs(item.score-median)>1e-9||item.triggered!==undefined&&item.triggered!==triggered)fail();
  return Object.freeze({status:'succeeded',score:median,threshold:videoDetailDefinition.threshold,guard:videoDetailDefinition.guard,sampleCount:8,width,height,frames,triggered});
}
export function validateVideoSourceAnalysis(value,duration,video){
  const fail=()=>{throw new Error('来源通道结果、复核门槛或完成状态不一致。');};
  if(!value||![1,2,3].includes(value.version)||!value.channels||Object.keys(value.channels).length!==2||value.version===1&&value.detail!==undefined||value.version!==3&&(value.evidence!==undefined||value.review!==undefined))fail();
  const channels={};
  for(const [id,definition] of Object.entries(videoSourceDefinitions)){
    const item=value.channels[id];if(!item||!['succeeded','failed'].includes(item.status))fail();
    if(item.status==='failed'){
      if(item.score!=null||item.triggered!=null||typeof item.error!=='string'||!item.error.trim()||item.error.length>500)fail();
      channels[id]=Object.freeze({status:'failed',error:item.error});continue;
    }
    if(!Number.isFinite(item.score)||item.score<0||item.score>1||item.threshold!==definition.threshold||!Number.isInteger(item.sampleCount)||item.sampleCount<1||item.sampleCount>definition.maxSamples||(id==='keyframes'&&item.sampleCount!==8))fail();
    const triggered=item.score>=definition.threshold;
    if(item.triggered!==undefined&&item.triggered!==triggered)fail();
    channels[id]=Object.freeze({status:'succeeded',score:item.score,threshold:definition.threshold,sampleCount:item.sampleCount,triggered});
  }
  const detail=value.version>=2?validateDetail(value.detail,channels,duration,video,fail,value.version===3):null;
  const joint=value.version===3?validateVideoReview(value.evidence,channels,detail,duration,fail):null;
  if(joint&&value.review&&(value.review.profileId!==joint.review.profileId||value.review.status!==joint.review.status||value.review.decision!==joint.review.decision||Object.keys(value.review).length!==3))fail();
  const complete=Object.values(channels).every(c=>c.status==='succeeded')&&detail?.status!=='failed';
  if(!Object.values(channels).some(c=>c.status==='succeeded'))fail();
  const conservative=channels.keyframes.status==='succeeded'?(channels.keyframes.triggered?'review':'not_triggered'):'incomplete';
  const complementary=joint?joint.review.decision:Object.values(channels).some(c=>c.triggered)||detail?.triggered?'review':complete?'not_triggered':'incomplete';
  const policies=Object.freeze({conservative,complementary});
  const outsideValidatedDuration=duration<4||duration>14;
  if(value.complete!==undefined&&value.complete!==complete||value.outsideValidatedDuration!==undefined&&value.outsideValidatedDuration!==outsideValidatedDuration)fail();
  if(value.policies&&(Object.keys(value.policies).length!==2||value.policies.conservative!==conservative||value.policies.complementary!==complementary))fail();
  return Object.freeze({version:value.version,channels:Object.freeze(channels),...(detail?{detail}:{}),...(joint?joint:{}),complete,policies,outsideValidatedDuration});
}
export function videoSourceRisk(analysis){
  if(analysis.policies.complementary==='incomplete')return 'unknown';
  if(analysis.policies.complementary==='not_triggered')return 'low';
  return [...Object.values(analysis.channels),analysis.detail].some(c=>c?.status==='succeeded'&&c.score>=.8)?'high':'medium';
}
export function aftersalesIncomplete(state){return state?.status!=='succeeded'||state.result?.sourceAnalysis?.complete===false||Boolean(frameLocalizationIncomplete(state.result?.frameLocalization));}
