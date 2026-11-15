import { validateAftersalesVideoFields, aftersalesVideoFieldLimits } from './materials.js';
import { validateVideoSourceAnalysis, videoSourceRisk } from './source-analysis.js';
import { validateFrameLocalization } from './frame-localization.js';

export const aftersalesDetectionKinds=Object.freeze({ai:'AI来源检测',tamper:'视频修改线索',comparison:'商品与问题核对'});
// 商品售后只开放已接入的商品凭证能力；修改线索保留通用结果协议。
export const aftersalesProductKinds=Object.freeze(['ai','comparison']);
export const aftersalesModificationTypes=Object.freeze({splice:'异常拼接',local:'局部修改',add:'添加',replace:'替换',remove:'消除',unknown:'未分类'});
export const aftersalesComparisonDimensions=Object.freeze({appearance:'商品外观',style:'商品款式',issue:'问题现象'});

export function validateAftersalesVideoResult(value,video,kind,fields) {
  const fail=()=>{throw new Error('检测结果不完整、位置越界或与当前视频版本不匹配。');};
  const text=(v,max=2000)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
  if(!value||value.videoId!==video.id||value.version!==video.version||value.kind!==kind||!Object.hasOwn(aftersalesDetectionKinds,kind)||!['full','partial'].includes(value.coverage)||!text(value.scope)||!text(value.summary,4000))fail();
  const segments=input=>{
    if(!Array.isArray(input)||input.length>100)fail();const ids=new Set();
    return Object.freeze(input.map(s=>{
      if(!s||!text(s.id,100)||ids.has(s.id)||!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start<0||s.end<=s.start||s.end>video.duration||!text(s.description))fail();
      if(kind==='tamper'&&!Object.hasOwn(aftersalesModificationTypes,s.type))fail();
      if(s.point!==undefined&&(kind!=='comparison'||typeof s.point!=='boolean'))fail();
      ids.add(s.id);return Object.freeze({id:s.id,start:s.start,end:s.end,description:s.description,...(kind==='tamper'?{type:s.type}:{}),...(s.point?{point:true}:{})});
    }));
  };
  const result={videoId:video.id,version:video.version,kind,coverage:value.coverage,scope:value.scope,summary:value.summary};
  if(value.sourceAnalysis!==undefined){
    if(kind!=='ai'||value.coverage!=='partial'||value.score!==undefined||value.applicability!==undefined)fail();
    result.sourceAnalysis=validateVideoSourceAnalysis(value.sourceAnalysis,video.duration,video);
    if(value.risk!==videoSourceRisk(result.sourceAnalysis))fail();
  }
  if(value.frameLocalization!==undefined){
    if(kind!=='ai'||!result.sourceAnalysis||value.coverage!=='partial')fail();
    result.frameLocalization=validateFrameLocalization(value.frameLocalization,video,result.sourceAnalysis);
  }
  if(value.applicability!==undefined){
    if(!['applicable','not_applicable'].includes(value.applicability)||kind==='comparison'||value.applicability==='not_applicable'&&(kind!=='tamper'||value.score!==null||value.risk!=='unknown'||value.segments?.length||value.frames?.length))fail();
    if(value.applicability==='applicable'&&(!Number.isFinite(value.score)||value.score<0||value.score>1))fail();
    result.applicability=value.applicability;result.score=value.score;
  }
  if(kind==='comparison'){
    if(!Array.isArray(value.checks)||value.checks.length!==3)fail();const seen=new Set();
    const references={appearance:[fields.productName,fields.productInfo].filter(Boolean).join('\n'),style:fields.style||'',issue:fields.description||''};
    result.references=Object.freeze(references);
    result.checks=Object.freeze(value.checks.map(check=>{
      if(!check||!Object.hasOwn(aftersalesComparisonDimensions,check.dimension)||seen.has(check.dimension)||!['match','mismatch','unknown'].includes(check.outcome)||!text(check.observed)||!text(check.evidence)||(!references[check.dimension].trim()&&check.outcome!=='unknown'))fail();
      seen.add(check.dimension);return Object.freeze({dimension:check.dimension,outcome:check.outcome,observed:check.observed,evidence:check.evidence,segments:segments(check.segments)});
    }));
  }else{
    if(!['low','medium','high','unknown'].includes(value.risk)||!Array.isArray(value.frames)||value.frames.length>30)fail();
    result.risk=value.risk;result.segments=segments(value.segments);
    result.frames=Object.freeze(value.frames.map(frame=>{if(!frame||!Number.isFinite(frame.time)||frame.time<0||frame.time>=video.duration||!text(frame.label,200))fail();return Object.freeze({time:frame.time,label:frame.label});}));
  }
  return Object.freeze(result);
}

export function runAftersalesOperation(handler,input,signal,timeoutMs) {
  const controller=new AbortController();let timer,onAbort;
  const interruption=new Promise((resolve,reject)=>{
    onAbort=()=>{controller.abort();reject(new Error('操作已取消。'));};signal.addEventListener('abort',onAbort,{once:true});if(signal.aborted)onAbort();
    timer=setTimeout(()=>{controller.abort();reject(new Error('操作超时，请重试。'));},timeoutMs);
  });
  const work=Promise.resolve().then(()=>{if(controller.signal.aborted)throw new Error('操作已取消。');return handler(input,{signal:controller.signal});});
  return Promise.race([work,interruption]).finally(()=>{clearTimeout(timer);signal.removeEventListener('abort',onAbort);});
}

export function createAftersalesVideoDetection({timeoutMs=60000}={}) {
  let adapters={},activeRuns=0;
  return {
    get busy(){return activeRuns>0;},
    configure(handlers){
      if(activeRuns)throw new Error('请先取消或等待检测完成。');
      if(handlers===null){adapters={};return;}
      if(!handlers||Object.entries(handlers).some(([key,handler])=>!Object.hasOwn(aftersalesDetectionKinds,key)||typeof handler!=='function'))throw new TypeError('仅支持ai、tamper、comparison函数。');
      adapters={...handlers};
    },
    createSession({onChange=()=>{}}={}){
      let entries=[],fields={},signature='',revision=0,current=null,disposed=false;
      const empty=()=>({status:'idle',result:null,error:''}),notify=()=>{if(!disposed)onChange();};
      const release=run=>{if(!run.released){run.released=true;activeRuns--;}if(current===run)current=null;};
      const session={
        get busy(){return Boolean(current);},
        get entries(){return entries.map(entry=>({...entry,...Object.fromEntries(Object.keys(aftersalesDetectionKinds).map(kind=>[kind,{...entry[kind]}]))}));},
        sync(videos,nextFields){
          if(disposed)return;
          const next=Object.fromEntries(Object.keys(aftersalesVideoFieldLimits).map(key=>[key,String(nextFields[key]??'').trim()])),key=JSON.stringify(next),changed=key!==signature;
          const materialChanged=videos.length!==entries.length||videos.some((v,i)=>v.id!==entries[i]?.id||v.file!==entries[i]?.file||v.duration!==entries[i]?.duration);
          if(changed||materialChanged){session.cancel();revision++;}
          fields=next;signature=key;
          entries=videos.map(video=>{const old=entries.find(e=>e.id===video.id&&e.file===video.file&&e.duration===video.duration);return !changed&&old?Object.assign(old,video,{version:old.version}):{...video,version:revision,...Object.fromEntries(Object.keys(aftersalesDetectionKinds).map(kind=>[kind,empty()]))};});notify();
        },
        async run(kinds,ids=entries.map(e=>e.id)){
          if(disposed)throw new Error('页面已关闭。');if(current)throw new Error('正在检测，请勿重复操作。');
          if(!entries.length||!ids.length||ids.some(id=>!entries.some(e=>e.id===id)))throw new Error('请先添加视频凭证。');
          if(!kinds.length||kinds.some(kind=>!Object.hasOwn(aftersalesDetectionKinds,kind)))throw new Error('请选择检测类型。');
          const errors=validateAftersalesVideoFields(fields);if(Object.keys(errors).length)throw new Error(Object.values(errors)[0]);
          if(kinds.some(kind=>!adapters[kind]))throw new Error('所选检测服务尚未接入，未开始检测。');
          const run={controller:new AbortController(),released:false};current=run;activeRuns++;
          const jobs=[];for(const entry of entries.filter(e=>ids.includes(e.id)))for(const kind of new Set(kinds)){entry[kind]={status:'queued',result:null,error:''};jobs.push({entry,kind,handler:adapters[kind]});}notify();
          try{for(const {entry,kind,handler} of jobs){
            if(current!==run)break;entry[kind].status='running';notify();
            try{
              const video={id:entry.id,version:entry.version,file:entry.file,duration:entry.duration,width:entry.width,height:entry.height};
              const response=await runAftersalesOperation(handler,{fields:{...fields},video:{...video}},run.controller.signal,timeoutMs);if(current!==run)break;
              entry[kind]={status:'succeeded',result:validateAftersalesVideoResult(response,video,kind,fields),error:''};
            }catch(error){if(current!==run)break;entry[kind]={status:'failed',result:null,error:error?.message||'检测失败，请重试。'};}notify();
          }}finally{release(run);notify();}
        },
        cancel(){if(!current)return;const run=current;run.controller.abort();for(const e of entries)for(const kind of Object.keys(aftersalesDetectionKinds))if(['queued','running'].includes(e[kind].status))e[kind]={status:'cancelled',result:null,error:'检测已取消。'};release(run);notify();},
        dispose(){disposed=true;session.cancel();entries=[];},
      };return session;
    },
  };
}
export const aftersalesVideoDetection=createAftersalesVideoDetection({timeoutMs:360000});
