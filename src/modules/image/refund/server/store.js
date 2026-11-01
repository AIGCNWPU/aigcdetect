import { createHash } from 'node:crypto';
import { validateRefundFields, validateRefundFile, refundFieldLimits } from '../materials.js';
import { RefundServiceError } from './providers.js';
import { inspectRefundImage } from './image-header.js';

export const refundDigest=bytes=>createHash('sha256').update(bytes).digest('hex');
export class RefundSessionStore {
  constructor({maxBytes=200*1024*1024,maxSessions=8,ttlMs=30*60*1000,now=Date.now}={}) {
    this.records=new Map();this.bytes=0;this.maxBytes=maxBytes;this.maxSessions=maxSessions;this.ttlMs=ttlMs;this.now=now;
  }
  validId(id){return typeof id==='string' && /^c_[a-f0-9]{24}$/.test(id);}
  expiredIds(){return [...this.records].filter(([,record])=>this.now()-record.touched>=this.ttlMs).map(([id])=>id);}
  has(id){return this.records.has(id);}
  get(id){
    const record=this.validId(id)?this.records.get(id):null;
    if(!record || this.now()-record.touched>=this.ttlMs)throw new RefundServiceError('本次分析已结束或过期，请重新提交当前材料。',404,'SESSION_NOT_FOUND');
    record.touched=this.now();return structuredClone(record.item);
  }
  delete(id){const record=this.records.get(id);if(record){this.bytes-=record.size;this.records.delete(id);}}
  clear(){this.records.clear();this.bytes=0;}
  save(payload){
    if(!this.validId(payload?.id))throw new RefundServiceError('分析会话编号无效。');
    if(!payload || typeof payload.fields!=='object' || !Array.isArray(payload.files) || payload.files.length<1 || payload.files.length>10)throw new RefundServiceError('请提交案件资料及 1—10 张凭证。');
    const fields={};
    for(const key of Object.keys(refundFieldLimits)) { if(typeof payload.fields[key]!=='string')throw new RefundServiceError('案件字段必须为文本。'); fields[key]=payload.fields[key].trim(); }
    const errors=validateRefundFields(fields);
    if(Object.keys(errors).length)throw new RefundServiceError(Object.values(errors)[0]);
    const files=payload.files.map((file,index)=>{
      if(!file || typeof file.name!=='string' || file.name.length>255 || typeof file.data!=='string' || file.data.length>7*1024*1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data) || file.data.length%4)throw new RefundServiceError('图片编码或文件名无效。');
      const bytes=Buffer.from(file.data,'base64');if(bytes.toString('base64')!==file.data)throw new RefundServiceError('图片编码无效。');const reason=validateRefundFile({...file,size:bytes.length});
      if(reason)throw new RefundServiceError(reason);
      const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
      const jpeg=bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
      const webp=bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP';
      const type=png?'image/png':jpeg?'image/jpeg':webp?'image/webp':null;
      if(!type || type!==file.type)throw new RefundServiceError('图片内容与格式不符。');
      const dimensions=inspectRefundImage(bytes,type);
      const sha256=refundDigest(bytes);
      return {bytes,metadata:{id:`i_${sha256.slice(0,24)}_${index}`,name:file.name,type,size:bytes.length,sha256,...dimensions}};
    });
    const fingerprint=refundDigest(JSON.stringify({fields,images:files.map(({metadata:{width,height,...identity}})=>identity)}));
    const id=payload.id;
    if(this.records.has(id)){
      const existing=this.get(id);
      if(existing.fingerprint!==fingerprint)throw new RefundServiceError('当前材料与分析会话不一致，请重新提交。',409,'SESSION_CONFLICT');
      return existing;
    }
    const size=files.reduce((total,file)=>total+file.bytes.length,0);
    if(this.records.size>=this.maxSessions || this.bytes+size>this.maxBytes)throw new RefundServiceError('临时分析空间繁忙，请关闭其他分析页面后重试。',503,'SESSION_CAPACITY');
    const item={id,fingerprint,fields,images:files.map(f=>f.metadata),createdAt:new Date(this.now()).toISOString(),version:2};
    this.records.set(id,{item,files,size,touched:this.now()});this.bytes+=size;
    return structuredClone(item);
  }
  image(sessionId,id){
    const item=this.get(sessionId),image=item.images.find(i=>i.id===id);
    if(!image)throw new RefundServiceError('图片与当前分析不匹配。',404,'IMAGE_NOT_FOUND');
    const file=this.records.get(sessionId).files.find(f=>f.metadata.id===id);
    return {image,bytes:Buffer.from(file.bytes),fields:item.fields};
  }
}
