import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBatch } from '../src/modules/image/documents/server/batch-engine.js';
import { combinationId } from '../src/modules/image/documents/server/cross-material-coverage.js';
const types=['identity','invoice','digital_invoice','receipt','certificate'];
function material(id,type,value='甲') {const sha=(id==='a'?'a':'b').repeat(64);return {id,type,version:1,fileSha256:sha,pages:[{number:1,status:'succeeded',width:500,height:500}],fields:[{id:'f',version:1,key:'name',role:'subject',value,confidence:.99,period:'2026-10',source:{fileSha256:sha,page:1,provider:'synthetic',observedText:value||'空白',polygon:[[1,1],[50,1],[50,20],[1,20]]}}]};}
function ctx(extra={}) {return {batchId:'batch',batchVersion:1,relations:[{id:'r',kind:'same_entity',status:'confirmed',reviewer:'fixture',reason:'reviewed relationship',basisType:'reviewer_confirmation',left:{materialId:'a',role:'subject'},right:{materialId:'b',role:'subject'},...extra}]};}
let n=0;
for(let i=0;i<5;i++) for(let j=i;j<5;j++) {
 const code=`C${String(++n).padStart(2,'0')}`;
 for(const mode of ['consistent','conflict','missing','ambiguous','period']) test(`${code} generic gate: ${mode}`,()=>{
  const a=material('a',types[i]),b=material('b',types[j],mode==='conflict'?'乙':'甲');
  if(mode==='missing') b.fields=[];
  if(mode==='period') b.fields[0].period='2025';
  const r=evaluateBatch({id:'batch',version:1,materials:[a,b]},mode==='ambiguous'?{}:ctx());
  assert.equal(combinationId(types[j],types[i]),code);assert.equal(r.pairs[0].combinationId,code);
  if(mode==='missing') {assert.equal(r.pairs[0].status,'NEI');assert.deepEqual(r.pairs[0].missingOnRight,['name']);}
  else {assert.equal(r.candidates[0].status,{consistent:'PASS',conflict:'FAIL',ambiguous:'NEI',period:'NOT_APPLICABLE'}[mode]);assert.deepEqual(r.candidates[0].evidence.map(e=>e.source.page),[1,1]);}
 });
}
test('one transaction may have multiple invoice numbers',()=>{
 const a=material('a','invoice','100'),b=material('b','digital_invoice','101');
 for(const m of [a,b]) m.fields[0].key='invoice_number';
 const batch={id:'batch',version:1,materials:[a,b]};
 assert.equal(evaluateBatch(batch,ctx({kind:'same_transaction'})).candidates[0].reason,'same_invoice_not_confirmed');
 assert.equal(evaluateBatch(batch,ctx({kind:'same_transaction',documentScopeConfirmed:true})).candidates[0].status,'FAIL');
});
test('same file with differing field revisions is not skipped',()=>{
 const a=material('a','identity'),b=material('b','identity','乙');b.fileSha256=a.fileSha256;b.fields[0].source.fileSha256=a.fileSha256;
 const r=evaluateBatch({id:'batch',version:1,materials:[a,b]},ctx());assert.equal(r.candidates[0].status,'FAIL');assert.equal(r.pairs[0].sameSource,true);assert.equal(r.duplicates.length,1);
});
test('empty values and unconfigured facts cannot pass or fail by string comparison',()=>{
 for(const key of ['name','arbitrary_claim']) {const a=material('a','certificate',''),b=material('b','certificate','');a.fields[0].key=b.fields[0].key=key;assert.equal(evaluateBatch({id:'batch',version:1,materials:[a,b]},ctx()).candidates[0].status,'NEI');}
});
