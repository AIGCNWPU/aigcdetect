import test from 'node:test';
import assert from 'node:assert/strict';
import {displayedDate} from '../src/modules/image/documents/server/date-fields.js';
import {evaluateBatch} from '../src/modules/image/documents/server/batch-engine.js';
test('calendar boundaries and leap centuries are explicit',()=>{
  for (const value of ['1900-02-29','2100-02-29','2026-04-31','2026-00-01','0000-01-01','2026-01-00']) assert.equal(displayedDate(value,'YYYY-MM-DD').status,'FAIL',value);
  for (const value of ['2000-02-29','2024-02-29','2026-04-30']) assert.equal(displayedDate(value,'YYYY-MM-DD').status,'PASS',value);
});
test('format ambiguity and OCR noise are not silently repaired',()=>{
  assert.equal(displayedDate('01/02/2026').status,'NEI');
  assert.equal(displayedDate('2O26-01-01','YYYY-MM-DD').status,'NEI');
  assert.equal(displayedDate('01/02/2026','DD/MM/YYYY').canonical,'2026-02-01');
  assert.equal(displayedDate('01/02/2026','MM/DD/YYYY').canonical,'2026-01-02');
  assert.equal(displayedDate('85-75-4478','DD-MM-YYYY').status,'FAIL');
});
function material(id,value,format,confidence=.99) {
  const hash=id.repeat(64);
  return {id,version:1,type:'identity',fileSha256:hash,pages:[{number:1,status:'succeeded',width:200,height:100}],fields:[{id:'birth',version:1,key:'birth_date',role:'subject',value,dateFormat:format,confidence,source:{provider:'controlled_test',fileSha256:hash,page:1,observedText:value,polygon:[[0,0],[100,0],[100,20],[0,20]]}}]};
}
test('different confirmed date formats compare as the same date with source retained',()=>{
  const batch={id:'b',version:1,materials:[material('a','2000-02-29','YYYY-MM-DD'),material('b','29/02/2000','DD/MM/YYYY')]};
  const context={batchId:'b',batchVersion:1,relations:[{id:'r',kind:'same_entity',status:'confirmed',reviewer:'reviewer',reason:'explicit fixture relation',basisType:'reviewer_confirmation',left:{materialId:'a',role:'subject'},right:{materialId:'b',role:'subject'}}]};
  const r=evaluateBatch(batch,context);assert.equal(r.candidates[0].status,'PASS');assert.equal(r.candidates[0].evidence[1].value,'29/02/2000');
  batch.materials[1].fields[0].confidence=.5;assert.equal(evaluateBatch(batch,context).checks[1].status,'NEI');
});
test('different issue dates do not become conflicts merely from same person',()=>{
  const a=material('a','2025-01-01','YYYY-MM-DD'),b=material('b','2026-01-01','YYYY-MM-DD');
  a.fields[0].key=b.fields[0].key='issue_date';
  const batch={id:'b',version:1,materials:[a,b]};
  const context={batchId:'b',batchVersion:1,relations:[{id:'r',kind:'same_entity',status:'confirmed',reviewer:'reviewer',reason:'same subject',basisType:'reviewer_confirmation',left:{materialId:'a',role:'subject'},right:{materialId:'b',role:'subject'}}]};
  assert.equal(evaluateBatch(batch,context).candidates[0].reason,'same_date_event_not_confirmed');
});
