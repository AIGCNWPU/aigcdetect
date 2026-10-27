import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {runReview} from '../src/modules/image/documents/server/review-workflow.js';
const root=fileURLToPath(new URL('../../runtime/replay/review-20261026/workflow-tests/',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture({docx=false,stageFailure=null,wrongOcrHash=false,wrongOcrSize=false,wrongParsedHash=false,files=1,confirmations=[],textContent=null}={}) {
 await mkdir(root,{recursive:true});const output=await mkdtemp(path.join(root,'run-'));
 const payload={coreMaterialId:'m1',role:'company',objective:'invoice_review',jurisdiction:'CN',confirmations,files:Array.from({length:files},(_,i)=>({id:`m${i+1}`,name:`fixture-${i+1}.${docx?'docx':'png'}`,materialType:'invoice',contentBase64:Buffer.from(`synthetic parser fixture ${i}`).toString('base64')}))};
 const order=[],adapters={
  async runLocal(command,args) {
   if(args[0]!=='scripts/image-validation/parse_material.py')throw new Error('thumbnail_not_part_of_fixture');
   const input=args[args.indexOf('--input')+1],dir=args[args.indexOf('--output-dir')+1],id=args[args.indexOf('--material-id')+1];
   await mkdir(dir,{recursive:true});const bytes=await readFile(input);
   const parsed={schema:'material-parse/0.1',material_id:id,file_sha256:wrongParsedHash?'0'.repeat(64):hash(bytes),status:docx?'partial':'completed',kind:docx?'docx':'image',coverage:{},pages:[],blocks:[]};
   if(docx)parsed.blocks=(textContent||'开票日期：2026-02-30').split('\n').map((text,i)=>({id:`p${i+1}`,kind:'paragraph',text,source:'docx_xml',source_location:{part:'word/document.xml',paragraph:i+1}}));
   else {await writeFile(path.join(dir,'page.png'),bytes);parsed.pages=[{page:1,status:'completed',rendered_file:'page.png',rendered_size:[200,200],rendered_sha256:hash(bytes),source_location:{frame:1}}];}
   await writeFile(path.join(dir,'material.json'),JSON.stringify(parsed));return {code:0};
  },
  async executeStage(name,manifest) {
   order.push(name);if(name===stageFailure)throw new Error('stage_failed');
   const rows=JSON.parse(await readFile(manifest));
   return {provider:'synthetic_workflow_test',model_asset_sha256:{},samples:rows.map(row=>({sample_id:row.sample_id,status:'succeeded',input_sha256:wrongOcrHash&&name==='ocr'?'f'.repeat(64):row.expected_sha256,stored_size:[200,200],oriented_size:wrongOcrSize&&name==='ocr'?[100,100]:[200,200],generated_score:.1,detector_score:.2,regions:name==='ocr'?[{region_id:'r1',coordinate_space:'exif_oriented_image_pixels',source:{page:1,input_sha256:wrongOcrHash?'f'.repeat(64):row.expected_sha256},observed_text:textContent||'开票日期：2026-02-30',recognition_confidence:.99,polygon:[[1,1],[90,1],[90,20],[1,20]]}]:[]}))};
  }
 };
 return {payload,output,order,adapters};
}
test('workflow executes MIRROR then SEED then OCR and always runs local rules',async()=>{
 const f=await fixture();const r=await runReview(f.payload,f.output,()=>{},f.adapters);
 assert.deepEqual(f.order,['mirror','seed','ocr']);assert.equal(r.materials[0].stages.rules.status,'completed');assert.equal(r.review.checks.find(c=>c.rule==='displayed_calendar_date').status,'FAIL');assert.equal(r.materials[0].stages.explanation.status,'not_run');
});
test('failed visual model does not suppress OCR or independent local rules',async()=>{
 const f=await fixture({stageFailure:'mirror'});const r=await runReview(f.payload,f.output,()=>{},f.adapters);
 assert.equal(r.status,'partial');assert.equal(r.materials[0].stages.mirror.status,'failed');assert.equal(r.materials[0].stages.ocr.status,'completed');assert.equal(r.review.checks.find(c=>c.rule==='displayed_calendar_date').status,'FAIL');
});
test('text-only DOCX has structural evidence and partial visual coverage',async()=>{
 const f=await fixture({docx:true});const r=await runReview(f.payload,f.output,()=>{},f.adapters);
 assert.deepEqual(f.order,[]);assert.equal(r.status,'partial');assert.equal(r.materials[0].stages.mirror.status,'not_run');
 const date=r.review.checks.find(c=>c.rule==='displayed_calendar_date');assert.equal(date.status,'FAIL');assert.equal(date.evidence[0].source.location.paragraph,1);assert.equal(date.evidence[0].source.polygon,undefined);assert.equal(r.review.execution,'partial');
});
test('OCR from another source image is rejected before assigning parent file hash',async()=>{
 const f=await fixture({wrongOcrHash:true});const r=await runReview(f.payload,f.output,()=>{},f.adapters);
 assert.equal(r.materials[0].stages.ocr.status,'failed');assert.equal(r.materials[0].fields.length,0);assert.equal(r.status,'partial');
});
test('OCR geometry must match actual rendered page dimensions',async()=>{
 const f=await fixture({wrongOcrSize:true});const r=await runReview(f.payload,f.output,()=>{},f.adapters);
 assert.equal(r.materials[0].stages.ocr.status,'failed');assert.equal(r.materials[0].fields.length,0);
});
test('parser output bound to a different source cannot enter detection',async()=>{
 const f=await fixture({wrongParsedHash:true});const r=await runReview(f.payload,f.output,()=>{},f.adapters);
 assert.equal(r.materials[0].status,'failed');assert.equal(r.materials[0].fields.length,0);assert.equal(f.order.length,0);
});
test('same values do not create automatic relations; explicit confirmation preserves trust label',async()=>{
 const f=await fixture({files:2});let r=await runReview(f.payload,f.output,()=>{},f.adapters);assert.equal(r.review.plan.edges.length,0);
 const g=await fixture({files:2,confirmations:[{materialId:'m2',kind:'same_transaction',coreRole:'transaction',auxiliaryRole:'transaction',reason:'Both sources reviewed',dateScopeConfirmed:true}]});r=await runReview(g.payload,g.output,()=>{},g.adapters);
 assert.equal(r.review.plan.edges.length,1);assert.equal(r.review.candidates[0].relationshipEvidence.trust,'user_asserted_not_external_verified');
});
test('unresolved original DOCX clauses reach semantic review without a SEED finding',async()=>{
 const textContent='合同约定：甲方应当在验收后支付尾款。\n开票日期：2026-02-30';
 const f=await fixture({docx:true,textContent});f.payload.options={semanticReview:true,privacyMode:'original'};
 let sent;
 f.adapters.semanticSender=async request=>{
  sent=JSON.parse(request.messages[1].content);
  return {summary:'合同条件仍须结合履约记录核对。',items:sent.items.map(i=>({id:i.id,verdict:'needs_more_information',explanation:'材料载明验收后支付，但尚未提供验收记录。',warning:'',recommendation:'补充验收记录。',evidenceIds:[i.evidenceIds[0]]}))};
 };
 const r=await runReview(f.payload,f.output,()=>{},f.adapters);
 assert.ok(sent.evidence.some(e=>e.text===textContent.split('\n')[0]));assert.equal(sent.privacyMode,'original');
 assert.equal(r.materials[0].stages.seed.status,'not_run');assert.equal(r.semanticReview.status,'completed');
 assert.equal(r.review.checks.find(c=>c.rule==='displayed_calendar_date').status,'FAIL');assert.equal(r.presentation.status,'issues_found');
 assert.ok(r.presentation.warnings.length);assert.equal(r.presentation.aiReview.findings.length,sent.items.length);
});
test('disabled semantic review performs no request even with unresolved text',async()=>{
 const f=await fixture({docx:true,textContent:'合同约定验收通过后支付尾款。'});let calls=0;
 f.adapters.semanticSender=async()=>{calls++;throw new Error('must not send');};
 const r=await runReview(f.payload,f.output,()=>{},f.adapters);
 assert.equal(calls,0);assert.equal(r.semanticReview.status,'not_run');assert.equal(r.semanticReview.reason,'disabled');
 assert.ok(r.review.executionAssessment.counts.B>0);assert.equal(r.presentation.status,'needs_more_information');
});
test('semantic failure preserves local findings and produces a visible unfinished result',async()=>{
 const f=await fixture({docx:true,textContent:'合同付款应当验收后支付。\n开票日期：2026-02-30'});f.payload.options={semanticReview:true,privacyMode:'original'};
 f.adapters.semanticSender=async()=>{throw new Error('simulated provider failure');};
 const r=await runReview(f.payload,f.output,()=>{},f.adapters);
 assert.equal(r.semanticReview.status,'failed');assert.equal(r.presentation.status,'issues_found');
 assert.ok(r.presentation.actions.some(a=>a.includes('暂未完成')));assert.ok(r.review.checks.some(c=>c.status==='FAIL'));
 assert.doesNotMatch(JSON.stringify(r),/simulated provider failure/);
});
