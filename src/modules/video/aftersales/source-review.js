import { videoReviewProfile } from './source-review-profile.js';

export function videoReviewDetailSkipReason(channels){
  if(channels.keyframes.status==='succeeded'&&channels.keyframes.triggered)return 'frame_triggered';
  if(Object.values(channels).some(c=>c.status!=='succeeded'))return 'prerequisite_unavailable';
  return null;
}
function videoReviewQuantile(values,q){
  const a=[...values].sort((x,y)=>x-y),p=(a.length-1)*q,lo=Math.floor(p),hi=Math.ceil(p);
  return a[lo]+(a[hi]-a[lo])*(p-lo);
}
function videoReviewLogit(value){const p=Math.max(1e-5,Math.min(1-1e-5,value));return Math.log(p)-Math.log1p(-p);}
function videoReviewPair(values){return Math.max(...values.slice(1).map((value,i)=>Math.min(values[i],value)));}
export function videoReviewDecision(native,full,detail){
  if(!Number.isFinite(native)||native<0||native>1||[full,detail].some(a=>!Array.isArray(a)||a.length!==8||a.some(p=>!Number.isFinite(p)||p<0||p>1)))throw new Error('多帧来源依据不完整。');
  const m=videoReviewQuantile(full,.5),d=videoReviewQuantile(detail,.5);
  if(m>=.35755555331707006||(m>=.2163227200508118&&d>=.824063926935196))return true;
  const x=[native,m,videoReviewPair(full),d,videoReviewPair(detail),videoReviewQuantile(full,.25),videoReviewQuantile(full,.75),videoReviewQuantile(detail,.25),videoReviewQuantile(detail,.75)].map(videoReviewLogit);
  let margin=videoReviewProfile.intercept;
  for(const tree of videoReviewProfile.trees){let at=0;while(tree[at][0]!==-1){const n=tree[at];at=x[n[0]]<=n[1]?n[2]:n[3];}margin+=tree[at][1];}
  return margin>=videoReviewProfile.threshold;
}
export function validateVideoReview(value,channels,detail,duration,fail){
  if(!value||!Array.isArray(value.fullFrames))fail();
  const frames=[];
  if(channels.keyframes.status==='failed'){
    if(value.fullFrames.length)fail();
  }else{
    if(value.fullFrames.length!==8)fail();
    let index=-1,time=-1;
    for(const f of value.fullFrames){
      if(!f||!Number.isInteger(f.frame_index)||f.frame_index<=index||f.frame_index>=200000||!Number.isFinite(f.time)||f.time<0||f.time>=duration||f.time<=time||!Number.isFinite(f.score)||f.score<0||f.score>1||typeof f.frame_sha256!=='string'||!/^[a-f0-9]{64}$/.test(f.frame_sha256))fail();
      index=f.frame_index;time=f.time;
      frames.push(Object.freeze({frame_index:index,time,score:f.score,frame_sha256:f.frame_sha256}));
    }
    if(Math.abs(videoReviewQuantile(frames.map(f=>f.score),.5)-channels.keyframes.score)>1e-9)fail();
  }
  if(detail.status==='succeeded'&&detail.frames.some((f,i)=>f.frame_index!==frames[i]?.frame_index||Math.abs(f.time-frames[i].time)>1e-6))fail();
  let status,decision;
  if(channels.keyframes.status==='succeeded'&&channels.keyframes.triggered){status='frame_triggered';decision='review';}
  else if(Object.values(channels).some(c=>c.status!=='succeeded')||detail.status!=='succeeded'){
    status='incomplete';decision=Object.values(channels).some(c=>c.triggered)||detail.triggered?'review':'incomplete';
  }else{status='evaluated';decision=videoReviewDecision(channels.video.score,frames.map(f=>f.score),detail.frames.map(f=>f.score))?'review':'not_triggered';}
  return {evidence:Object.freeze({fullFrames:Object.freeze(frames)}),review:Object.freeze({profileId:videoReviewProfile.id,status,decision})};
}
