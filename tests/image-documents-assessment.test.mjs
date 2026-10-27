import test from 'node:test';
import assert from 'node:assert/strict';
import {businessChecks} from '../src/modules/image/documents/server/business-rules.js';
import {decimal,evidence} from '../src/modules/image/documents/server/batch-engine.js';
import {assessExecution} from '../src/modules/image/documents/server/execution-assessment.js';
import {presentReview} from '../src/modules/image/documents/server/review-presentation.js';
import {extractOcrMaterial} from '../src/modules/image/documents/server/ocr-fields.js';
const hash='a'.repeat(64);
function field(key,value,extra={}){return {id:key,key,value,role:'transaction',version:1,confidence:.99,currency:'CNY',taxScope:'line-1',source:{fileSha256:hash,provider:'test',observedText:value,page:1,polygon:[[1,1],[50,1],[50,20],[1,20]]},...extra};}
const material=fields=>({id:'core',type:'digital_invoice',fields,version:1,fileSha256:hash,pages:[{number:1,status:'succeeded',width:1000,height:800}]});
const checks=fields=>businessChecks(material(fields),{evidence,decimal});
test('explicit zero tax line conflicts even when invoice totals add correctly',()=>{
 const r=checks([field('tax_rate','0%'),field('line_tax_amount','13'),field('line_net_amount','100'),field('gross_amount','113',{taxScope:undefined})]);
 assert.equal(r[0].status,'FAIL');assert.equal(r[0].reason,'zero_displayed_rate_tax_consistency');
 assert.equal(checks([field('tax_rate','0%'),field('tax_amount','0')])[0].status,'PASS');
});
test('rate arithmetic uses exact fixed decimals and bounded cent rounding',()=>{
 for(const [net,rate,tax,expected] of [['100','13%','13','PASS'],['100','13%','14','FAIL'],['100','13%','13.01','PASS'],['-100','13%','-13','PASS']])assert.equal(checks([field('tax_rate',rate),field('line_net_amount',net),field('line_tax_amount',tax)])[0].status,expected);
});
test('mixed scopes and missing scope never compare one line against entire invoice tax',()=>{
 assert.equal(checks([field('tax_rate','0%',{taxScope:undefined}),field('tax_amount','13')])[0].status,'NEI');
 assert.equal(checks([field('tax_rate','0%'),field('tax_amount','13',{taxScope:'invoice-total'})])[0].status,'NEI');
});
test('exemption, differential tax, low recognition and ambiguous values abstain',()=>{
 for(const rate of ['免税','不征税','***','13','101%'])assert.equal(checks([field('tax_rate',rate),field('tax_amount','13')])[0].status,'NEI');
 assert.equal(checks([field('tax_rate','0%'),field('tax_amount','13'),field('tax_method','差额计税')])[0].status,'NEI');
 assert.equal(checks([field('tax_rate','0%',{confidence:.5}),field('tax_amount','13')])[0].status,'NEI');
 assert.equal(checks([field('tax_rate','0%'),field('tax_amount','13',{extractionAmbiguous:true})])[0].status,'NEI');
});
test('explicit date intervals fail reversal without comparing different date meanings',()=>{
 const r=checks([field('travel_start_date','2026-10-20',{dateFormat:'YYYY-MM-DD'}),field('travel_end_date','2026-10-19',{dateFormat:'YYYY-MM-DD'})]);
 assert.equal(r[0].status,'FAIL');
 assert.equal(checks([field('invoice_date','2026-10-20'),field('transaction_date','2026-10-19')]).length,0);
});
function reviewFixture(){
 const m=material([field('gross_amount','113')]);
 const review={plan:{coreMaterialId:'core',objective:'invoice_review',edges:[],aggregates:[],excluded:[]},checks:[{rule:'invoice_net_tax_gross',status:'FAIL',reason:'displayed_amount_arithmetic_only',materialId:'core',evidence:[evidence(m,m.fields[0])]}],candidates:[],incompletePages:[]};
 return {batch:{id:'b',version:1,materials:[m]},materials:[{...m,status:'completed',textBlocks:[]}],review};
}
test('definitive local contradiction is A/local, with no semantic request',()=>{
 const f=reviewFixture(),a=assessExecution(f);assert.equal(a.items[0].grade,'A');assert.equal(a.items[0].route,'local');assert.equal(a.counts.B,0);assert.equal(a.coverage.localResolutionRate,1);assert.equal(a.calibration,'not_calibrated');
});
test('context review is independent of SEED and does not send low quality text for guessing',()=>{
 const f=reviewFixture();f.materials[0].textBlocks=[{id:'b1',text:'合同约定验收之后支付首期款，余款在完成交付后结算。',confidence:.99}];
 let a=assessExecution(f);assert.equal(a.counts.B,1);assert.equal(a.items.find(i=>i.grade==='B').route,'semantic');
 f.materials[0].textBlocks[0].confidence=.5;a=assessExecution(f);assert.equal(a.counts.B,0);assert.equal(a.counts.C,1);
});
test('missing policy is D/unsupported and missing relation is C, neither guessed by model',()=>{
 const f=reviewFixture();f.review.plan.objective='research_reimbursement';f.review.checks.push({rule:'institution_policy',status:'NEI',reason:'institution_policy_not_configured',evidence:[]});
 f.review.plan.excluded=[{materialId:'aux',reason:'no_confirmed_core_relationship'}];
 const a=assessExecution(f);assert.equal(a.items.find(i=>i.rule==='institution_policy').route,'unsupported');assert.equal(a.items.find(i=>i.rule==='material_relationship').route,'supplement');
});
test('unrelated auxiliary text does not become semantic evidence',()=>{
 const f=reviewFixture();const aux={...material([]),id:'aux'};f.batch.materials.push(aux);f.materials.push({...aux,textBlocks:[{id:'a',text:'合同规定应当支付款项，否则需要返还相应款项。',confidence:1}]});
 assert.equal(assessExecution(f).counts.B,0);
});
test('presentation preserves local conflict even when AI declares reasonable',()=>{
 const f=reviewFixture();f.review.executionAssessment=assessExecution(f);
 const p=presentReview({...f,semanticReview:{status:'succeeded',summary:'语义内容合理',items:[{assessmentId:'check-1',verdict:'reasonable',explanation:'示例'}]}});
 assert.equal(p.status,'issues_found');assert.equal(p.warnings.length,1);
});
test('no model response cannot be presented as semantic success; omissions prevent clean bill',()=>{
 const f=reviewFixture();f.review.checks[0].status='PASS';f.review.executionAssessment=assessExecution(f);
 let p=presentReview({...f,semanticReview:{status:'not_run',reason:'provider_not_configured',summary:'malformed stale summary'}});assert.equal(p.aiReview.summary,'');
 p=presentReview({...f,semanticReview:{status:'succeeded',summary:'完成',items:[],omitted:['missing']}});assert.equal(p.status,'needs_more_information');
});
test('visual findings stay visible even when local content is consistent',()=>{
 const f=reviewFixture();f.review.checks[0].status='PASS';f.review.executionAssessment=assessExecution(f);f.materials[0].stages={seed:{status:'completed',score:.9},mirror:{status:'completed',score:.1}};
 const p=presentReview(f);assert.equal(p.status,'issues_found');assert.match(p.warnings[0].title,/局部修改/);
});
test('partial visual coverage keeps suspicious findings from completed pages',()=>{
 const f=reviewFixture();f.review.checks[0].status='PASS';f.review.executionAssessment=assessExecution(f);
 f.materials[0].status='partial';f.materials[0].stages={seed:{status:'partial',score:.9},mirror:{status:'partial',score:.8}};
 const p=presentReview(f);assert.equal(p.status,'issues_found');assert.equal(p.warnings.length,2);
});
test('real OCR table geometry binds each tax rate only to its own row',()=>{
 const region=(id,text,x,y,w=60)=>({region_id:id,observed_text:text,recognition_confidence:.99,polygon:[[x,y],[x+w,y],[x+w,y+20],[x,y+20]],coordinate_space:'exif_oriented_image_pixels',source:{page:1,input_sha256:hash}});
 const sample={status:'succeeded',input_sha256:hash,oriented_size:[1000,800],regions:[region('title','电子发票（普通发票）',300,10,300),region('net','金额',600,100),region('rate','税率',750,100),region('tax','税额',900,100),region('n1','100',600,150),region('r1','0%',750,150),region('t1','2',900,150),region('n2','100',600,200),region('r2','13%',750,200),region('t2','13',900,200),region('total','合计',50,300),region('ns','¥200',600,300),region('ts','¥15',900,300)]};
 const m=extractOcrMaterial(sample,{id:'core',type:'digital_invoice'}).material;
 const results=businessChecks(m,{evidence,decimal});assert.deepEqual(results.map(r=>r.status),['FAIL','PASS']);assert.equal(m.fields.filter(f=>f.key==='tax_rate').some(f=>f.extractionAmbiguous),false);
});
