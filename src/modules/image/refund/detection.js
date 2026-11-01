import { validateRefundLocalization } from './localization.js';
import { validateRefundFields } from './materials.js';
import { validateRefundComparison } from './comparison.js';

export const refundDetectionKinds=Object.freeze({ai:'AI生成凭证检测',tamper:'局部篡改检测',comparison:'商品与描述核对'});
export const refundRegionTypes=Object.freeze({add:'添加',replace:'替换',splice:'拼接',remove:'消除',unknown:'候选区域'});

// Scene adapter shape only. A real backend adapter maps its public contract here.
export function validateRefundDetectionResult(value,imageId,kind,fields={}) {
  if(kind==='comparison')return validateRefundComparison(value,imageId,fields);
  const invalid=()=>{throw new Error('检测结果不完整或与当前图片不匹配，请重试。');};
  const text=(input,max)=>typeof input==='string' && input.trim().length>0 && input.length<=max;
  if (!value || value.imageId!==imageId || value.kind!==kind || !['low','medium','high','unknown'].includes(value.risk) ||
      !['full','partial'].includes(value.coverage) || !text(value.summary,4000) || !text(value.scope,2000)) invalid();
  const result={imageId,kind,risk:value.risk,summary:value.summary,coverage:value.coverage,scope:value.scope};
  if(kind==='ai' && value.provenance?.provider==='CO-SPY' && Number.isFinite(value.provenance.generatedScore) && value.provenance.generatedScore>=0 && value.provenance.generatedScore<=1)result.provenance=Object.freeze({provider:value.provenance.provider,generatedScore:value.provenance.generatedScore});
  if (kind==='tamper') {
    if (!Array.isArray(value.regions) || value.regions.length>100) invalid();
    const ids=new Set();
    result.regions=Object.freeze(value.regions.map(region=>{
      if (!region || !text(region.id,100) || ids.has(region.id) || !Object.hasOwn(refundRegionTypes,region.type) || !text(region.description,2000)) invalid();
      const box=region.box;
      if (!box || !['x','y','width','height'].every(key=>Number.isFinite(box[key])) || box.x<0 || box.y<0 || box.width<=0 || box.height<=0 || box.x+box.width>1 || box.y+box.height>1) invalid();
      ids.add(region.id);
      return Object.freeze({id:region.id,type:region.type,description:region.description,box:Object.freeze({x:box.x,y:box.y,width:box.width,height:box.height})});
    }));
    if(value.localization){if(value.risk!=='unknown')invalid();result.localization=validateRefundLocalization(value.localization,result.regions);}
  }
  return Object.freeze(result);
}

export function createRefundDetection({timeoutMs=120000}={}) {
  let adapters={}, activeRuns=0;
  const empty=()=>({status:'idle',result:null,error:''});
  function execute(handler,input,signal) {
    const controller=new AbortController();
    let timer,onAbort;
    const interruption=new Promise((resolve,reject)=>{
      onAbort=()=>{controller.abort();reject(new Error('检测已取消。'));};
      signal.addEventListener('abort',onAbort,{once:true});
      if (signal.aborted) onAbort();
      timer=setTimeout(()=>{controller.abort();reject(new Error('检测超时，请重试。'));},timeoutMs);
    });
    const work=Promise.resolve().then(()=>{
      if (controller.signal.aborted) throw new Error('检测已取消。');
      return handler(input,{signal:controller.signal});
    });
    return Promise.race([work,interruption]).finally(()=>{clearTimeout(timer);signal.removeEventListener('abort',onAbort);});
  }
  return {
    get busy() {return activeRuns>0;},
    configure(handlers) {
      if (activeRuns) throw new Error('正在检测，请先取消或等待完成。');
      if (handlers===null) {adapters={};return;}
      if (!handlers || Object.keys(handlers).some(key=>!Object.hasOwn(refundDetectionKinds,key) || typeof handlers[key]!=='function')) throw new TypeError('检测适配器仅支持ai、tamper或comparison函数。');
      adapters={...handlers};
    },
    createSession({onChange=()=>{}}={}) {
      let entries=[],fields={},signature='',current=null,disposed=false;
      const notify=()=>{if(!disposed)onChange();};
      const release=run=>{if(!run.released){run.released=true;activeRuns--;}if(current===run)current=null;};
      const session={
        get busy(){return Boolean(current);},
        get entries(){return entries.map(entry=>({...entry,...Object.fromEntries(Object.keys(refundDetectionKinds).map(kind=>[kind,{...entry[kind]}]))}));},
        sync(images,nextFields) {
          if (disposed) return;
          const next=Object.fromEntries(['caseNumber','productName','style','productInfo','description'].map(key=>[key,String(nextFields[key]||'').trim()]));
          const key=JSON.stringify(next), changed=key!==signature;
          if (changed || images.length!==entries.length || images.some((image,index)=>image.id!==entries[index]?.id || image.file!==entries[index]?.file)) session.cancel();
          fields=next;signature=key;
          entries=images.map(image=>{
            const old=entries.find(entry=>entry.id===image.id && entry.file===image.file);
            // Pending jobs retain this entry; unchanged inputs must preserve its identity.
            return !changed && old ? Object.assign(old,image) : {...image,...Object.fromEntries(Object.keys(refundDetectionKinds).map(kind=>[kind,empty()]))};
          });
          notify();
        },
        async run(kinds,ids=entries.map(entry=>entry.id)) {
          if (disposed) throw new Error('页面已关闭。');
          if (current) throw new Error('正在检测，请勿重复操作。');
          if (!entries.length || !ids.length || ids.some(id=>!entries.some(entry=>entry.id===id))) throw new Error('请先添加图片凭证。');
          if (!kinds.length || kinds.some(kind=>!Object.hasOwn(refundDetectionKinds,kind))) throw new Error('请选择检测类型。');
          const errors=validateRefundFields(fields);
          if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
          const missing=kinds.filter(kind=>!adapters[kind]);
          if (missing.length) throw new Error(`${missing.map(kind=>refundDetectionKinds[kind]).join('、')}服务尚未接入，未开始检测。`);
          const run={controller:new AbortController(),released:false};current=run;activeRuns++;
          const jobs=[];
          for(const entry of entries.filter(item=>ids.includes(item.id))) for(const kind of new Set(kinds)) {
            entry[kind]={status:'queued',result:null,error:''};jobs.push({entry,kind,handler:adapters[kind]});
          }
          notify();
          try {
            for(const {entry,kind,handler} of jobs) {
              if (current!==run) break;
              entry[kind].status='running';notify();
              try {
                const response=await execute(handler,{fields:{...fields},image:{id:entry.id,file:entry.file,width:entry.width,height:entry.height}},run.controller.signal);
                if(current!==run)break;
                entry[kind]={status:'succeeded',result:validateRefundDetectionResult(response,entry.id,kind,fields),error:''};
              } catch(error) {
                if(current!==run)break;
                entry[kind]={status:'failed',result:null,error:error?.message || '检测失败，请重试。'};
              }
              notify();
            }
          } finally {release(run);notify();}
        },
        cancel() {
          if (!current) return;
          const run=current;run.controller.abort();
          for(const entry of entries) for(const kind of Object.keys(refundDetectionKinds)) if(['queued','running'].includes(entry[kind].status)) entry[kind]={status:'cancelled',result:null,error:'检测已取消。'};
          release(run);notify();
        },
        dispose() {disposed=true;session.cancel();entries=[];},
      };
      return session;
    },
  };
}

export const refundDetection=createRefundDetection();
