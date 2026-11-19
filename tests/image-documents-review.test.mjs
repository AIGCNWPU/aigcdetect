import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {planReview,evaluateReview,buildUserConfirmedRelations} from '../src/modules/image/documents/server/review-plan.js';
import {getReviewScenarios} from '../src/modules/image/documents/server/review-scenarios.js';
const sha=x=>createHash('sha256').update(x).digest('hex');
function material(id,value='100',type='invoice',key='gross_amount') {
 const hash=sha(id);
 return {id,type,jurisdiction:'CN',version:1,fileSha256:hash,pages:[{number:1,status:'succeeded',width:600,height:800}],fields:[{id:'f1',version:1,key,value,role:'transaction',confidence:.99,currency:'CNY',basis:'gross_due',source:{provider:'test',fileSha256:hash,page:1,observedText:value,polygon:[[1,1],[50,1],[50,20],[1,20]]}}]};
}
const batch=(...materials)=>({id:'batch',version:1,materials});
const relation=(id,left,right)=>({id,left:{materialId:left,role:'transaction'},right:{materialId:right,role:'transaction'},kind:'same_transaction',status:'confirmed',reviewer:'fixture',reason:'independent reviewed transaction',basisType:'reviewer_confirmation',amountScopeConfirmed:true});
const options=(relations=[])=>({coreMaterialId:'core',objective:'invoice_review',role:'company',jurisdiction:'CN',batchId:'batch',batchVersion:1,relations});

test('core and objective must be explicit; invalid core never falls back to all pairs',()=>{
 assert.throws(()=>planReview(batch(material('core')),{}),/coreMaterialId/);
 assert.throws(()=>planReview(batch(material('core')),{coreMaterialId:'core'}),/objective/);
});
test('unconfirmed same amount and same-name evidence is excluded with NEI',()=>{
 const b=batch(material('core'),material('a'));
 const r=evaluateReview(b,options());assert.equal(r.candidates.length,0);assert.equal(r.plan.excluded[0].reason,'no_confirmed_core_relationship');assert.equal(r.perMaterial.length,2);
 const rel=relation('r','core','a');rel.status='proposed';assert.equal(planReview(b,options([rel])).edges.length,0);
});
test('confirmed core edge compares both source versions; auxiliary pairs never run',()=>{
 const b=batch(material('core'),material('a','90'),material('b','80'));
 const r=evaluateReview(b,options([relation('a','core','a'),relation('b','a','b')]));
 assert.equal(r.candidates.length,1);assert.equal(r.candidates[0].status,'FAIL');assert.equal(r.candidates[0].evidence.length,2);
 assert.equal(r.plan.rejectedRelations[0].reason,'not_adjacent_to_core');assert.equal(r.candidates[0].evidence[0].materialVersion,1);
});
test('scoped indexes are linear for 10/100/200 materials, without global combinations',()=>{
 for(const n of [10,100,200]) {
  const b=batch(material('core'),...Array.from({length:n-1},(_,i)=>material(`m${i}`)));
  const rels=b.materials.slice(1).map(m=>relation(m.id,'core',m.id));
  const r=evaluateReview(b,options(rels));assert.equal(r.plan.edges.length,n-1);assert.equal(r.candidates.length,n-1);assert.equal(r.plan.complexity.relationsInspected,n-1);
 }
});
test('multiple fields per role yield one NEI rather than Cartesian products',()=>{
 const a=material('core'),b=material('a');for(let i=0;i<100;i++){a.fields.push({...a.fields[0],id:`a${i}`});b.fields.push({...b.fields[0],id:`b${i}`});}
 const r=evaluateReview(batch(a,b),options([relation('r','core','a')]));assert.equal(r.candidates.length,1);assert.equal(r.candidates[0].reason,'missing_or_ambiguous_role_field');
});
test('comparison field itself cannot justify relationship',()=>{
 const r=relation('r','core','a');r.basisType='source_fields';r.basis=[{materialId:'core',fieldId:'f1'}];
 const result=evaluateReview(batch(material('core'),material('a','90')),options([r]));assert.equal(result.candidates[0].status,'NEI');
});
test('role mismatch produces no false comparison, stale context rejects',()=>{
 const b=batch(material('core'),material('a'));const c=options([relation('r','core','a')]);c.relations[0].right.role='seller';
 assert.equal(evaluateReview(b,c).candidates[0].status,'NEI');assert.throws(()=>planReview(b,{...c,batchVersion:2}),/stale/);
});
test('source duplicates stay visible without duplicate cross checks; failures remain partial',()=>{
 const core=material('core'),copy=structuredClone(core);copy.id='copy';copy.pages.push({number:2,status:'failed'});
 const r=evaluateReview(batch(core,copy),options([relation('r','core','copy')]));assert.equal(r.duplicates.length,1);assert.equal(r.candidates.length,0);assert.equal(r.perMaterial.length,2);assert.equal(r.execution,'partial');assert.equal(r.overallAuthenticity,null);
});
test('explicit complete settlement sums core payments, respects refund and incomplete scope',()=>{
 const a=material('a','120','bank_receipt','payment_amount'),b=material('b','-20','bank_receipt','payment_amount');
 for(const m of [a,b])Object.assign(m.fields[0],{paymentIssuer:'bank',paymentReference:m.id});
 const batchValue=batch(material('core'),a,b),o=options();
 o.settlements=[{id:'set',target:{materialId:'core',fieldId:'f1'},payments:[{materialId:'a',fieldId:'f1'},{materialId:'b',fieldId:'f1'}],complete:true,scopeConfirmed:true,reviewer:'fixture',reason:'entire settlement'}];
 let r=evaluateReview(batchValue,o);assert.equal(r.checks.find(x=>x.rule==='settlement_sum').status,'PASS');assert.equal(r.plan.aggregates.length,1);
 o.settlements[0].complete=false;r=evaluateReview(batchValue,o);assert.equal(r.checks.find(x=>x.rule==='settlement_sum').status,'NEI');
 o.settlements[0].target.materialId='a';r=evaluateReview(batchValue,o);assert.equal(r.plan.aggregates.length,0);assert.equal(r.plan.rejectedGroups[0].reason,'aggregate_target_is_not_core');
});
test('Indonesian or unknown jurisdiction never runs China invoice/identity formats',()=>{
 for(const jurisdiction of ['ID',null]) {
  const m=material('core','123','digital_invoice','invoice_number');m.jurisdiction=jurisdiction;
  const r=evaluateReview(batch(m),{...options(),jurisdiction});assert.equal(r.checks.some(x=>x.rule==='invoice_number_format'),false);assert.equal(r.checks.find(x=>x.rule==='jurisdiction_specific_rules').status,'NEI');
 }
});
test('function scope is sourced and independent of user identity',()=>{
 const catalog=getReviewScenarios();assert.equal(catalog.profiles.length,5);assert.equal('roles' in catalog,false);
 for(const p of catalog.profiles){assert.equal('roles' in p,false);assert.ok(p.sourceIds.length);}
 for(const role of [undefined,'company','government_police','arbitrary']) {
  const r=evaluateReview(batch(material('core')),{...options(),role});
  assert.equal(r.plan.scenario.status,'PASS');assert.equal('role' in r.plan,false);
  assert.equal(r.checks.find(x=>x.rule==='institution_policy').status,'NEI');
 }
});
test('DOCX text locations support local rules without fabricating pixel/page evidence',()=>{
 const m=material('core','2026-02-30','certificate','issue_date');m.representation='docx_text';m.pages=[];m.fields[0].dateFormat='YYYY-MM-DD';
 m.fields[0].source={fileSha256:m.fileSha256,provider:'docx_xml',observedText:'2026-02-30',location:{part:'word/document.xml',paragraph:1}};
 const r=evaluateReview(batch(m),{...options(),objective:'identity_consistency'});assert.equal(r.checks.find(x=>x.rule==='displayed_calendar_date').status,'FAIL');assert.equal(r.checks[0].evidence[0].source.polygon,undefined);
 m.fields[0].source.location.paragraph=0;assert.throws(()=>evaluateReview(batch(m),options()),/structural/);
});
test('unbounded relation inputs are rejected before candidates',()=>{
 assert.throws(()=>planReview(batch(material('core')),options(Array.from({length:9},(_,i)=>relation(String(i),'core','a')))),/budget/);
});

test('user confirmation is explicit, narrow and labeled as unverified assertion',()=>{
 const b=batch(material('core'),material('a','90'));
 assert.deepEqual(buildUserConfirmedRelations(b,{coreMaterialId:'core'}).relations,[]);
 const c={materialId:'a',kind:'same_transaction',coreRole:'transaction',auxiliaryRole:'transaction',reason:'I reviewed both sources',amountScopeConfirmed:true,reviewer:'fake-official',basisType:'external_registry'};
 const trusted=buildUserConfirmedRelations(b,{coreMaterialId:'core',confirmations:[c]});
 assert.equal(trusted.relations[0].reviewer,'local-workbench-user');assert.equal(trusted.relations[0].trust,'user_asserted_not_external_verified');assert.equal(trusted.relations[0].basisType,'reviewer_confirmation');
 assert.equal(evaluateReview(b,{...options(),...trusted}).candidates[0].status,'FAIL');
 for(const bad of [{...c,materialId:'missing'},{...c,materialId:'core'},{...c,coreRole:'seller'},{...c,auxiliaryRole:'buyer'},{...c,reason:''}])assert.throws(()=>buildUserConfirmedRelations(b,{coreMaterialId:'core',confirmations:[bad]}));
 assert.throws(()=>buildUserConfirmedRelations(b,{coreMaterialId:'core',confirmations:[c,c]}),/Duplicate/);
});
