// Real OCR and optionally real provider responses. No synthetic/model answers are injected.
// Publisher groups are candidates, not verified business relationships or ground truth.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {extractOcrMaterial} from '../../src/modules/image/documents/server/ocr-fields.js';
import {evaluateReview} from '../../src/modules/image/documents/server/review-plan.js';
import {assessExecution} from '../../src/modules/image/documents/server/execution-assessment.js';
import {buildSemanticPackage,runSemanticReview} from '../../src/modules/image/documents/server/semantic-review.js';
const [rootArg,outArg,liveFlag]=process.argv.slice(2);
if(!rootArg||!outArg)throw new Error('Usage: node evaluate-chinese-semantic.mjs PLATFORM_ROOT FROZEN_RUN [--live]');
const root=path.resolve(rootArg),out=path.resolve(outArg),live=liveFlag==='--live';
if(!out.startsWith(root+path.sep))throw new Error('Output must stay inside platform root');
const load=async p=>JSON.parse(await readFile(p,'utf8'));
const save=async(p,v)=>writeFile(p,JSON.stringify(v,null,2)+'\n',{flag:'wx',mode:0o600});
const sha=b=>createHash('sha256').update(b).digest('hex');
const manifest=await load(path.join(out,'ocr-manifest.json')),groups=await load(path.join(out,'groups.json')),ocr=await load(path.join(out,'ocr.json'));
if(ocr.samples.length!==manifest.length)throw new Error('Wait for all frozen OCR inputs to finish');
const target=path.join(out,live?'semantic-live':'semantic-dry');await mkdir(target,{recursive:true,mode:0o700});
const baseReport={version:'chinese-real-semantic/0.1',createdAt:new Date().toISOString(),live,apiBudget:8,independentHoldout:false,
  scope:'native local extraction/plan, followed by explicitly separate publisher-group candidate semantic diagnostic; annotations never sent to provider',
  groupResults:[],calls:[]};
// A batch-wide persisted budget, including errors. Never print headers or provider errors.
const nativeFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
  if(!live||url!=='https://api.deepseek.com/chat/completions')throw new Error('unauthorized_evaluation_endpoint');
  let ledger,index;
  for(let n=1;n<=8;n++)try{ledger=path.join(target,`attempt-${n}.json`);await save(ledger,{attempt:n,startedAt:new Date().toISOString(),requestSha256:sha(options.body)});index=n;break;}catch(e){if(e.code!=='EEXIST')throw e;}
  if(!index)throw new Error('evaluation_budget_exhausted');
  const started=Date.now();let response;
  try {
    response=await nativeFetch(url,options);
    const data=response.ok?await response.clone().json().catch(()=>null):null;
    const usage=Object.fromEntries(Object.entries(data?.usage||{}).filter(([k,v])=>['prompt_tokens','completion_tokens','total_tokens','prompt_cache_hit_tokens','prompt_cache_miss_tokens'].includes(k)&&Number.isInteger(v)));
    await save(path.join(target,`attempt-${index}-usage.json`),{attempt:index,httpStatus:response.status,seconds:(Date.now()-started)/1000,model:data?.model,finishReason:data?.choices?.[0]?.finish_reason,usage});
    return response;
  }catch {await save(path.join(target,`attempt-${index}-transport.json`),{attempt:index,status:'transport_failed',seconds:(Date.now()-started)/1000});throw new Error('evaluation_transport_failed');}
};
const byId=new Map(ocr.samples.map(s=>[s.sample_id,s]));
for(const group of groups) {
 const materials=[];
 for(const id of group.sample_ids) {
  const row=manifest.find(r=>r.sample_id===id),sample=byId.get(id);
  if(sample?.status!=='succeeded')continue;
  const actual=sha(await readFile(row.path));if(actual!==row.expected_sha256||actual!==sample.input_sha256)throw new Error('OCR evidence source mismatch');
  const material=extractOcrMaterial({...sample,model_asset_sha256:ocr.model_asset_sha256},{id,type:row.material_type}).material;
  material.textBlocks=sample.regions.map(r=>({id:r.region_id,text:r.observed_text,confidence:r.recognition_confidence,page:1}));
  materials.push(material);
 }
 if(!materials.length){baseReport.groupResults.push({groupId:group.group_id,status:'no_usable_ocr'});continue;}
 const objective=group.group_id===34?'invoice_review':group.group_id===43?'identity_consistency':'procurement_review';
 const batch={id:`real-crosscred-${group.group_id}`,version:1,materials};
 const review=evaluateReview(batch,{coreMaterialId:materials[0].id,objective,jurisdiction:'CN'});
 review.executionAssessment=assessExecution({batch,review,materials});
 const singleResults=materials.map(m=>({materialId:m.id,result:evaluateReview({...batch,id:batch.id+'-'+m.id,materials:[m]},{coreMaterialId:m.id,objective,jurisdiction:'CN'})}));
 const native={groupId:group.group_id,materials:materials.map(m=>({id:m.id,fields:m.fields.length,textBlocks:m.textBlocks.length,highQualityBlocks:m.textBlocks.filter(b=>b.confidence>=.9).length})),review,singleResults};
 await save(path.join(target,`group-${group.group_id}-local.json`),{...native,batch});
 baseReport.groupResults.push({groupId:group.group_id,materials:native.materials,assessment:review.executionAssessment.counts,nativeEdges:review.plan.edges.length,localChecks:singleResults.flatMap(x=>x.result.checks).map(c=>({rule:c.rule,status:c.status}))});
 if(![1,34,72,74].includes(group.group_id))continue;
 // Inspect two fixed original files per group. This does NOT manufacture a verified relation.
 const subset=materials.slice(0,2),candidateReview=structuredClone(review);
 candidateReview.plan.edges=[];
 candidateReview.executionAssessment.items=[{id:`candidate-group-${group.group_id}`,rule:'relationship_context_review',grade:'B',route:'semantic',status:'NEI',reason:'publisher_group_candidate_requires_evidence_review',materialIds:subset.map(m=>m.id),evidence:[]}];
 for(const privacyMode of ['redacted','original']) {
  const pkg=buildSemanticPackage({batch:{...batch,materials:subset},review:candidateReview,materials:subset,objective,privacyMode});
  pkg.background.evaluationMode='publisher_group_candidate_not_verified_relation';
  pkg.background.policyReferences=[];
  pkg.background.policyRetrieval='not_requested_for_dataset_content_consistency';
  pkg.background.relationshipInstruction='仅将这些文件作为待核对候选；先说明实际可见的共同标识及各自角色，未确认同一主体/同一凭证/口径时不得把差异判成错误。允许分别指出每份材料自己的矛盾。';
  for(const item of pkg.items)item.question='检查所列候选材料的内容：先从证据判断是否有相同凭证编号、合同编号或相同身份，分别指出共同依据、实际差异、可能的合法例外及缺证。不要假设同批材料必然属于同一交易；没有足够关系证据不得报告确定矛盾。合理与不合理都解释。';
  const dir=path.join(target,`g${group.group_id}-${privacyMode}`);await mkdir(dir,{recursive:true,mode:0o700});
  await save(path.join(dir,'package.json'),pkg);
  const result=await runSemanticReview(pkg,{enabled:live,outputDir:dir,model:'deepseek-flash',timeoutMs:90000});
  await save(path.join(dir,'result.json'),result);
  const row={groupId:group.group_id,privacyMode,status:result.status,reason:result.reason,items:pkg.items.length,evidence:pkg.evidence.length,characters:JSON.stringify(pkg).length,losses:pkg.losses,verdicts:result.items?.map(i=>i.verdict)||[],explanations:result.items?.map(i=>i.explanation)||[]};
  baseReport.calls.push(row);console.log(JSON.stringify({groupId:row.groupId,privacyMode,status:row.status,reason:row.reason,items:row.items,evidence:row.evidence,verdicts:row.verdicts}));
 }
}
await save(path.join(target,'report.json'),baseReport);
globalThis.fetch=nativeFetch;
