import { aftersalesVideoFieldLimits, validateAftersalesVideoFields } from './materials.js';

/** Internal frontend seam; the integrating adapter maps File objects to the shared backend contract. */
export function createAftersalesVideoSubmission() {
  let adapter=null,busy=false;
  return {
    get busy(){return busy;},
    get configured(){return Boolean(adapter);},
    configure(handler){
      if(busy)throw new Error('正在提交，请稍后配置接口。');
      if(handler!==null&&typeof handler!=='function')throw new TypeError('提交适配器必须是函数或 null。');
      adapter=handler;
    },
    async submit(fields,videos,{signal}={}){
      if(busy)throw new Error('正在提交，请勿重复操作。');
      const errors=validateAftersalesVideoFields(fields);
      if(Object.keys(errors).length)throw new Error(Object.values(errors)[0]);
      if(!videos.length)throw new Error('请至少添加一个视频凭证。');
      if(!adapter){const error=new Error('提交服务尚未接入，视频未上传。');error.code='BACKEND_NOT_CONNECTED';throw error;}
      if(signal?.aborted)throw new Error('提交已取消。');
      const snapshot={fields:Object.fromEntries(Object.keys(aftersalesVideoFieldLimits).map(key=>[key,String(fields[key]??'').trim()])),videos:videos.map(({id,file,duration,width,height})=>({id,file,duration,width,height}))};
      busy=true;let onAbort;
      try{
        const cancelled=new Promise((resolve,reject)=>{onAbort=()=>reject(new Error('提交已取消。'));signal?.addEventListener('abort',onAbort,{once:true});});
        const result=await Promise.race([adapter(snapshot,{signal}),cancelled]);
        if(signal?.aborted)throw new Error('提交已取消。');
        if(result?.accepted!==true||typeof result.receiptId!=='string'||!result.receiptId.trim())throw new Error('后端未返回有效的材料接收回执。');
        return {accepted:true,receiptId:result.receiptId};
      }finally{signal?.removeEventListener('abort',onAbort);busy=false;}
    },
  };
}

export const aftersalesVideoSubmission=createAftersalesVideoSubmission();
