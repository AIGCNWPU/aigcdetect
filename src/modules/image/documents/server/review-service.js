import {documentRegions} from '../regions.js';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { platformRoot } from './local-runtime.js';
import { runReview } from './review-workflow.js';
import { getReviewScenarios } from './review-scenarios.js';
import {displayedDate} from './date-fields.js';

export const BODY_LIMIT=34*1024*1024;
export class ReviewError extends Error {
  constructor(code,message,status=400){super(message);this.code=code;this.status=status;}
}
const bad=message=>{throw new ReviewError('INVALID_REVIEW',message);};
const allowedTypes=new Set(['unknown','invoice','digital_invoice','receipt','identity','certificate','contract','order','bank_receipt','bank_statement','acceptance_record','delivery_note','reimbursement_form','research_approval','project_approval','travel_approval','household_register','application_form','authorization']);
export function validateReview(payload) {
  if(!payload||typeof payload!=='object'||Array.isArray(payload))bad('请求必须为对象');
  const scenarios=getReviewScenarios();
  if(!scenarios.profiles.some(p=>p.id===payload.objective))bad('请选择适用核验目的');
  if(!['CN','other'].includes(payload.jurisdiction))bad('请选择材料适用地区');
  if(!Array.isArray(payload.files)||!payload.files.length||payload.files.length>10)bad('每批提交1至10个文件');
  let total=0;const ids=new Set();
  for(const file of payload.files) {
    if(!file||typeof file.id!=='string'||!/^[-a-zA-Z0-9_]{1,80}$/.test(file.id)||ids.has(file.id))bad('文件编号无效或重复');
    ids.add(file.id);
    if(typeof file.name!=='string'||file.name.length>180||/[\x00-\x1f/\\]/.test(file.name)||!/^.+\.(png|jpe?g|webp|tiff?|bmp|pdf|docx?|gif)$/i.test(file.name))bad('文件名或格式不支持');
    if(!allowedTypes.has(file.materialType||'unknown'))bad('材料类型不支持');
    const s=file.contentBase64;
    if(typeof s!=='string'||!s.length||s.length>16*1024*1024||s.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(s))bad('文件内容不是有效Base64或超过12MiB');
    const bytes=Buffer.from(s,'base64');
    if(bytes.toString('base64')!==s||bytes.length>12*1024*1024)bad('文件编码或大小无效');
    total+=bytes.length;
  }
  if(total>24*1024*1024)bad('每批文件总大小不能超过24MiB');
  if(typeof payload.coreMaterialId!=='string'||!ids.has(payload.coreMaterialId))bad('请选择本批次中的核心文件');
  if(payload.options?.runModels!==undefined&&typeof payload.options.runModels!=='boolean')bad('检测选项无效');
  if(payload.options?.renderWord!==undefined&&typeof payload.options.renderWord!=='boolean')bad('Word解析选项无效');
  if(payload.options?.semanticReview!==undefined&&typeof payload.options.semanticReview!=='boolean')bad('智能复核选项无效');
  if(payload.options?.privacyMode!==undefined&&!['redacted','original'].includes(payload.options.privacyMode))bad('请选择脱敏核查或原文核查');
  if(payload.context!==undefined) {
    if(!payload.context||typeof payload.context!=='object'||Array.isArray(payload.context)||Object.keys(payload.context).some(k=>!['region','businessDate'].includes(k)))bad('审核背景只接受地区和业务日期');
    if(payload.context.region!==undefined&&!Object.hasOwn(documentRegions,payload.context.region))bad('审核地区无效');
    if(payload.context.businessDate!==undefined&&(typeof payload.context.businessDate!=='string'||displayedDate(payload.context.businessDate,'YYYY-MM-DD').status!=='PASS'))bad('业务日期无效');
    if(payload.jurisdiction!=='CN'&&payload.context.region&&payload.context.region!=='unspecified')bad('境外材料不适用中国地区制度');
  }
  if(payload.options?.explain===true)bad('外部解释目前仅通过有限预算的本地调试入口启用');
  if(payload.relations?.length)bad('请通过显式关联确认提交，不能直接指定受信关系');
  if(payload.confirmations!==undefined&&(!Array.isArray(payload.confirmations)||payload.confirmations.length>18))bad('关联确认数量无效');
  for(const c of payload.confirmations||[]) {
    if(!c||!ids.has(c.materialId)||c.materialId===payload.coreMaterialId||!['same_entity','same_transaction'].includes(c.kind)||typeof c.reason!=='string'||!c.reason.trim()||c.reason.length>500)bad('关联确认必须指向辅助材料并填写依据');
    if(!['transaction','subject','buyer','seller','payer','payee'].includes(c.coreRole)||!['transaction','subject','buyer','seller','payer','payee'].includes(c.auxiliaryRole))bad('关联角色无效');
    for(const key of ['amountScopeConfirmed','dateScopeConfirmed','documentScopeConfirmed'])if(c[key]!==undefined&&typeof c[key]!=='boolean')bad('关联范围确认无效');
  }
  return payload;
}

export function createReviewService({runner=runReview,root=path.join(platformRoot,'runtime/reviews')}={}) {
  let active=null;
  const jobs=new Map();
  return async function documents(payload) {
    if(payload?.action==='scenarios')return getReviewScenarios();
    if(payload?.action==='status') {
      if(!/^[a-f0-9-]{36}$/.test(payload.reviewId||''))bad('任务编号无效');
      if(jobs.has(payload.reviewId))return structuredClone(jobs.get(payload.reviewId));
      try {const result=JSON.parse(await readFile(path.join(root,payload.reviewId,'result.json'),'utf8'));return {...result,reviewId:payload.reviewId};}
      catch {throw new ReviewError('REVIEW_NOT_FOUND','任务不存在，或服务重启后尚无完整结果',404);}
    }
    if(payload?.action!=='review')bad('请选择提交核验、查询状态或场景目录');
    validateReview(payload);
    if(active)throw new ReviewError('REVIEW_BUSY','当前有一批材料正在处理，请稍后提交',429);
    const reviewId=randomUUID(),dir=path.join(root,reviewId);
    active=reviewId;
    try {await mkdir(dir,{recursive:true,mode:0o700});}catch(error){active=null;throw error;}
    const job={reviewId,status:'queued',phase:'queued',materials:[]};
    jobs.set(reviewId,job);
    // Keep a bounded in-memory index; original files/results remain on disk.
    if(jobs.size>100)jobs.delete(jobs.keys().next().value);
    setImmediate(async()=>{
      try {job.status='running';const result=await runner(payload,dir,patch=>Object.assign(job,structuredClone(patch)));Object.assign(job,result);}
      catch {Object.assign(job,{status:'failed',phase:'failed',error:{code:'REVIEW_FAILED',message:'本次处理失败，已保留原文件和本地运行记录。'}});}
      finally {active=null;}
    });
    return structuredClone(job);
  };
}
export const runDocumentsReview=createReviewService();
