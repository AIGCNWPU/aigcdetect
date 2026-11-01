import { validateAftersalesVideoResult, runAftersalesOperation } from './detection.js';
import { validateRefundDetectionResult } from '../../image/refund/detection.js';
import { aftersalesVideoFieldLimits } from './materials.js';

export function validateAftersalesCaseEvidence(value,caseNumber) {
  const fail=()=>{throw new Error('案件材料引用、版本或结果无效，请重新加载。');};
  const text=(v,max=200)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
  if(!value||value.caseNumber!==caseNumber||!text(value.caseRef)||!Array.isArray(value.materials)||value.materials.length>100)fail();
  const refs=new Set();
  const materials=value.materials.map(material=>{
    if(!material||material.caseRef!==value.caseRef||!text(material.materialRef)||refs.has(material.materialRef)||!text(material.version)||!['image','video'].includes(material.type)||!text(material.name,500)||!material.results)fail();
    refs.add(material.materialRef);
    let url=null;if(material.url!=null){try{const parsed=new URL(material.url);if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)fail();url=parsed.href;}catch{fail();}}
    if(material.type==='video'&&(!Number.isFinite(material.duration)||material.duration<=0))fail();
    if(!material.fields||Object.entries(aftersalesVideoFieldLimits).some(([key,max])=>typeof material.fields[key]!=='string'||material.fields[key].length>max))fail();
    const fields=Object.freeze(Object.fromEntries(Object.keys(aftersalesVideoFieldLimits).map(key=>[key,material.fields[key].trim()])));
    if(fields.caseNumber!==caseNumber)fail();
    const results={};
    for(const kind of ['ai','tamper','comparison']){
      const state=material.results[kind]||{status:'idle'};
      if(!['idle','queued','running','failed','cancelled','succeeded'].includes(state.status))fail();
      let result=null;
      if(state.status==='succeeded'){
        if(state.result?.version!==material.version)fail();
        result=material.type==='video'?validateAftersalesVideoResult(state.result,{id:material.materialRef,version:material.version,duration:material.duration},kind,fields):Object.freeze({...validateRefundDetectionResult(state.result,material.materialRef,kind,fields),version:material.version});
      }
      results[kind]=Object.freeze({status:state.status,result,error:typeof state.error==='string'?state.error.slice(0,2000):''});
    }
    return Object.freeze({caseRef:value.caseRef,materialRef:material.materialRef,version:material.version,type:material.type,name:material.name,url,duration:material.duration,fields,results:Object.freeze(results)});
  });
  return Object.freeze({caseNumber,caseRef:value.caseRef,materials:Object.freeze(materials)});
}

export function createAftersalesCaseEvidence({timeoutMs=60000,onChange=()=>{}}={}) {
  let adapter=null,current=null,data=null,disposed=false;
  const service={
    get busy(){return Boolean(current);},get data(){return data;},
    configure(handler){if(current)throw new Error('正在加载，请先取消。');if(handler!==null&&typeof handler!=='function')throw new TypeError('案件读取适配器必须为函数。');adapter=handler;},
    async load(caseNumber){
      if(disposed)throw new Error('页面已关闭。');if(current)throw new Error('正在加载，请勿重复操作。');
      data=null;onChange();caseNumber=String(caseNumber||'').trim();
      if(!caseNumber||caseNumber.length>100)throw new Error('请填写有效案件编号。');if(!adapter)throw new Error('案件读取服务尚未接入，未加载关联凭证。');
      const run={controller:new AbortController()};current=run;onChange();
      try{
        const response=await runAftersalesOperation(adapter,{caseNumber},run.controller.signal,timeoutMs);
        if(current!==run)throw new Error('操作已取消。');data=validateAftersalesCaseEvidence(response,caseNumber);return data;
      }finally{if(current===run)current=null;if(!disposed)onChange();}
    },
    cancel(){if(current){current.controller.abort();current=null;}data=null;if(!disposed)onChange();},
    dispose(){disposed=true;service.cancel();},
  };return service;
}
