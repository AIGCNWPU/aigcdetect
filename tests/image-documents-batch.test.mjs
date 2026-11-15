import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBatch, reviseField, isCurrent, decimal } from '../src/modules/image/documents/server/batch-engine.js';

function material(id,type='identity',values=[['identity_number','ID-A']]) {
  const sha=id.charCodeAt(0).toString(16).padStart(2,'0').repeat(32);
  return {id,type,version:1,fileSha256:sha,pages:[{number:1,width:600,height:800,status:'succeeded'}],
    fields:values.map(([key,value],i)=>({id:`f${i}`,key,value,version:1,role:'subject',confidence:.99,period:'2026-10',
      currency:key.endsWith('_amount')?'CNY':undefined,basis:key.endsWith('_amount')?'gross_due':undefined,
      source:{fileSha256:sha,page:1,provider:'synthetic_fixture',observedText:value,polygon:[[10,10],[100,10],[100,30],[10,30]]}}))};
}
function batch(...materials) { return {id:'batch-1',version:1,materials}; }
function context(kind='same_entity',extra={}) { return {batchId:'batch-1',batchVersion:1,relations:[{id:'r1',left:{materialId:'a',role:'subject'},right:{materialId:'b',role:'subject'},
  kind,status:'confirmed',reviewer:'fixture-reviewer',reason:'explicit independent review',basisType:'reviewer_confirmation',...extra}]}; }

test('same-name candidates do not merge people',()=>{
  const b=batch(material('a','identity',[['name','同名']]),material('b','household_register',[['name','同名']]));
  assert.equal(evaluateBatch(b).candidates[0].status,'NEI');
});
test('confirmed same subject exposes one-character ID disagreement with both sources',()=>{
  const b=batch(material('a'),material('b','household_register',[['identity_number','ID-B']]));
  const r=evaluateBatch(b,context());assert.equal(r.candidates[0].status,'FAIL');assert.equal(r.candidates[0].evidence.length,2);
});
test('same field cannot itself justify identity relation being checked',()=>{
  const b=batch(material('a'),material('b'));
  const c=context();c.relations[0].basisType='source_fields';c.relations[0].basis=[{materialId:'a',fieldId:'f0'}];
  assert.equal(evaluateBatch(b,c).candidates[0].status,'NEI');
});
test('independent referenced evidence can establish relation',()=>{
  const b=batch(material('a','identity',[['identity_number','ID-A'],['name','fixture']]),material('b'));
  const c=context();c.relations[0].basisType='source_fields';c.relations[0].basis=[{materialId:'a',fieldId:'f1'}];
  assert.equal(evaluateBatch(b,c).candidates.find(x=>x.evidence[0].key==='identity_number').status,'PASS');
});
test('employee and company roles are not interchangeable',()=>{
  const b=batch(material('a','identity',[['name','person']]),material('b','invoice',[['name','company']]));b.materials[1].fields[0].role='buyer_company';
  assert.equal(evaluateBatch(b,context()).candidates[0].status,'NEI');
});
test('historical names are not false conflicts',()=>{
  const b=batch(material('a','identity',[['name','old']]),material('b','household_register',[['name','new']]));b.materials[1].fields[0].period='2025';
  assert.equal(evaluateBatch(b,context()).candidates[0].status,'NOT_APPLICABLE');
});
test('same text with different semantic keys is not an equality requirement',()=>{
  const b=batch(material('a','receipt',[['buyer_name','Alex']]),material('b','receipt',[['seller_name','Alex']]));
  assert.equal(evaluateBatch(b,context()).candidates[0].status,'NOT_APPLICABLE');
});
test('amount equality needs confirmed scope, basis and currency',()=>{
  const b=batch(material('a','invoice',[['gross_amount','100']]),material('b','receipt',[['gross_amount','50']]));
  assert.equal(evaluateBatch(b,context('same_transaction')).candidates[0].status,'NEI');
  assert.equal(evaluateBatch(b,context('same_transaction',{amountScopeConfirmed:true})).candidates[0].status,'FAIL');
  b.materials[1].fields[0].currency='USD';
  assert.equal(evaluateBatch(b,context('same_transaction',{amountScopeConfirmed:true})).candidates[0].status,'NOT_APPLICABLE');
});
test('negative values and decimal sums remain exact',()=>{
  const b=batch(material('a','invoice',[['net_amount','-100.10'],['tax_amount','-6.20'],['gross_amount','-106.30']]));
  assert.equal(evaluateBatch(b).checks[0].status,'PASS');assert.equal(decimal('0.1')+decimal('0.2'),decimal('0.3'));
});
test('malformed and missing amounts are not silently corrected',()=>{
  const b=batch(material('a','invoice',[['net_amount','100'],['tax_amount','6..0'],['gross_amount','106']]));
  assert.equal(evaluateBatch(b).checks[0].status,'NEI');b.materials[0].fields.pop();assert.equal(evaluateBatch(b).checks[0].status,'NEI');
});
test('low confidence retains review state',()=>{
  const b=batch(material('a'),material('b'));b.materials[0].fields[0].confidence=.4;
  assert.equal(evaluateBatch(b,context()).candidates[0].status,'NEI');
});
test('field correction invalidates prior report and preserves original observation',()=>{
  const b=batch(material('a'),material('b','identity',[['identity_number','ID-B']]));const c=context();const old=evaluateBatch(b,c);
  const changed=reviseField(b,{materialId:'b',fieldId:'f0'},{value:'ID-A',reason:'reviewed original',actor:'reviewer',expectedFieldVersion:1});
  assert.equal(isCurrent(old,changed,c),false);assert.throws(()=>evaluateBatch(changed,c),/stale/);assert.equal(evaluateBatch(changed,{...c,batchVersion:changed.version}).candidates[0].status,'PASS');
  assert.equal(changed.materials[1].fields[0].source.observedText,'ID-B');assert.equal(b.materials[1].fields[0].value,'ID-B');
  assert.throws(()=>reviseField(changed,{materialId:'b',fieldId:'f0'},{value:'x',reason:'r',actor:'a',expectedFieldVersion:1}));
});
test('stale relation context also invalidates result',()=>{
  const b=batch(material('a'),material('b'));const c=context();const r=evaluateBatch(b,c);c.relations[0].reason='new evidence';assert.equal(isCurrent(r,b,c),false);
  assert.throws(()=>evaluateBatch(b,{...c,batchId:'another'}));
});
test('bad source, region and duplicate field fail validation',()=>{
  for(const mutation of [b=>b.materials[0].fields[0].source.fileSha256='b'.repeat(64),b=>b.materials[0].fields[0].source.polygon[0][0]=-1,b=>b.materials[0].fields.push(b.materials[0].fields[0])]){
    const b=batch(material('a'));mutation(b);assert.throws(()=>evaluateBatch(b));
  }
});
test('failed pages remain partial, identical files are not duplicate fraud',()=>{
  const a=material('a'),b=structuredClone(a);b.id='b';a.pages.push({number:2,status:'failed'});
  const r=evaluateBatch(batch(a,b));assert.equal(r.execution,'partial');assert.equal(r.duplicates.length,1);assert.equal(r.overallAuthenticity,null);
});
test('settlement deduplicates same payment and respects negative refunds',()=>{
  const target=material('a','invoice',[['gross_amount','100']]);
  const p=material('b','bank_receipt',[['payment_amount','120']]);Object.assign(p.fields[0],{paymentReference:'pay-1',paymentIssuer:'bank-1'});
  const copy=structuredClone(p);copy.id='c';
  const refund=material('d','bank_receipt',[['payment_amount','-20']]);Object.assign(refund.fields[0],{paymentReference:'refund-1',paymentIssuer:'bank-1'});
  const b=batch(target,p,copy,refund);
  const c={batchId:b.id,batchVersion:1,settlements:[{id:'s',target:{materialId:'a',fieldId:'f0'},payments:['b','c','d'].map(materialId=>({materialId,fieldId:'f0'})),complete:true,scopeConfirmed:true,reviewer:'reviewer',reason:'all payments for this invoice'}]};
  const r=evaluateBatch(b,c).checks.find(x=>x.rule==='settlement_sum');assert.equal(r.status,'PASS');assert.equal(r.deduplicatedPayments,1);
  c.settlements[0].complete=false;assert.equal(evaluateBatch(b,c).checks.find(x=>x.rule==='settlement_sum').status,'NEI');
});

test('collinear evidence cannot masquerade as a field box',()=>{
  const batch={id:'b',version:1,materials:[{id:'m',version:1,type:'identity',fileSha256:'a'.repeat(64),pages:[{number:1,status:'succeeded',width:100,height:100}],fields:[{id:'f',key:'name',role:'holder',value:'A',version:1,confidence:.99,source:{fileSha256:'a'.repeat(64),page:1,provider:'test',observedText:'A',polygon:[[1,1],[2,2],[3,3],[4,4]]}}]}]};
  assert.throws(()=>evaluateBatch(batch),/Degenerate/);
});
test('a previous engine version is not a current report even for unchanged inputs',()=>{
 const b=batch(material('a'));const r=evaluateBatch(b);r.engineVersion='material-batch/0.2';assert.equal(isCurrent(r,b),false);
});

test('普通缴费凭证不执行无关价税加总，带税额的收据仍执行',()=>{
 const ordinary=evaluateBatch(batch(material('a','receipt',[['payment_amount','100']])));
 assert.equal(ordinary.checks.some(r=>r.rule==='invoice_net_tax_gross'),false);
 const taxed=evaluateBatch(batch(material('a','receipt',[['tax_amount','10']])));
 assert.equal(taxed.checks.some(r=>r.rule==='invoice_net_tax_gross'),true);
});
