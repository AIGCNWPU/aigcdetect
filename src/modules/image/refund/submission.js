import { validateRefundFields } from './materials.js';

/** Client-only seam. Map this snapshot to the team's backend contract in the adapter. */
export function createRefundSubmission() {
  let adapter=null, busy=false;
  return {
    get busy() { return busy; },
    get configured() { return Boolean(adapter); },
    configure(handler) {
      if (busy) throw new Error('正在提交，请稍后再配置接口。');
      if (handler !== null && typeof handler !== 'function') throw new TypeError('提交适配器必须是函数或 null。');
      adapter=handler;
    },
    async submit(fields, images, {signal}={}) {
      if (busy) throw new Error('正在提交，请勿重复操作。');
      const errors=validateRefundFields(fields);
      if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
      if (!images.length) throw new Error('请至少添加一张图片凭证。');
      if (!adapter) {
        const error=new Error('后端尚未接入，材料未上传。请保留原始文件，当前页面内容未保存。');
        error.code='BACKEND_NOT_CONNECTED';
        throw error;
      }
      const snapshot={fields:Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,String(v).trim()])),files:images.map(item=>item.file)};
      if (signal?.aborted) throw new Error('提交已取消。');
      busy=true;
      let onAbort;
      try {
        const cancelled=new Promise((resolve,reject)=>{
          onAbort=()=>reject(new Error('提交已取消。'));
          signal?.addEventListener('abort',onAbort,{once:true});
        });
        const result=await Promise.race([adapter(snapshot,{signal}),cancelled]);
        if (signal?.aborted) throw new Error('提交已取消。');
        if (result?.accepted!==true || typeof result.receiptId!=='string' || !result.receiptId.trim()) throw new Error('后端未返回有效的材料接收回执。');
        return {accepted:true,receiptId:result.receiptId};
      } finally { signal?.removeEventListener('abort',onAbort); busy=false; }
    },
  };
}

export const refundSubmission = createRefundSubmission();
