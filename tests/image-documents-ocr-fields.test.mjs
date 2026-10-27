import test from 'node:test';
import assert from 'node:assert/strict';
import { extractOcrMaterial } from '../src/modules/image/documents/server/ocr-fields.js';
import { evaluateBatch } from '../src/modules/image/documents/server/batch-engine.js';
const sha='a'.repeat(64);
function region(id,text,x=10,y=10,w=120,confidence=.99) {return {region_id:id,observed_text:text,recognition_confidence:confidence,polygon:[[x,y],[x+w,y],[x+w,y+20],[x,y+20]],source:{page:1,input_sha256:sha},coordinate_space:'exif_oriented_image_pixels'};}
function extract(regions,type='identity') {return extractOcrMaterial({status:'succeeded',input_sha256:sha,oriented_size:[600,800],regions},{id:'a',type});}
test('inline value preserves whole OCR box, label evidence and fingerprint',()=>{
 const r=extract([region('r','姓名：张三')]);const f=r.material.fields[0];
 assert.equal(f.value,'张三');assert.equal(f.source.observedText,'姓名：张三');assert.equal(f.source.precision,'ocr_region');assert.equal(f.source.ocrFingerprint.length,64);assert.equal(f.source.regions[0].regionId,'r');
});
test('unique same-row value keeps both boxes and weaker label confidence',()=>{
 const r=extract([region('label','姓名',10,10,50,.5),region('value','张三',80,10,50)]);
 assert.equal(r.material.fields[0].confidence,.5);assert.equal(r.material.fields[0].source.regions.length,2);assert.equal(r.review[0].reason,'recognition_requires_review');
});
test('two same-row values are not guessed',()=>{
 const r=extract([region('label','姓名',10,10,50),region('a','甲',80,10,20),region('b','乙',120,10,20)]);
 assert.equal(r.material.fields.length,0);assert.equal(r.review[0].reason,'ambiguous_row_values');
});
test('two labels cannot claim one value',()=>{
 const r=extract([region('a','姓名',10,10,40),region('b','出生日期',55,10,60),region('v','2026-01-01',130,10,100)]);
 assert.equal(r.material.fields.length,0);assert(r.review.every(x=>x.reason==='value_shared_by_labels'));
});
test('repeated field candidates remain ambiguous for downstream rules',()=>{
 const r=extract([region('a','姓名：甲'),region('b','姓名：乙',10,50)]);
 assert.equal(r.material.fields.length,2);assert(r.material.fields.every(f=>f.extractionAmbiguous));
});
test('generic certificate name is not confused with issuer or subject',()=>{
 const r=extract([region('a','姓名：甲')],'certificate');assert.equal(r.material.fields.length,0);assert.deepEqual(r.coverage.unmatchedRegionIds,['a']);
});
test('explicit CNY amounts flow through actual arithmetic without losing raw text',()=>{
 const r=extract([region('a','不含税金额：CNY 100.10'),region('b','税额：人民币 6.20',10,50),region('c','价税合计（小写）：CNY 106.30',10,90)],'invoice');
 const check=evaluateBatch({id:'b',version:1,materials:[r.material]}).checks[0];assert.equal(check.status,'PASS');assert.equal(check.evidence[0].source.observedText,'不含税金额：CNY 100.10');
});
test('ambiguous currency or numeric OCR is not repaired into arithmetic',()=>{
 const r=extract([region('a','不含税金额：¥ 100'),region('b','税额：CNY 6..2',10,50),region('c','价税合计（小写）：CNY 106.2',10,90)],'invoice');
 assert.equal(evaluateBatch({id:'b',version:1,materials:[r.material]}).checks[0].status,'NEI');
});
test('wrong source, duplicate IDs and out-of-bounds unused regions are rejected',()=>{
 for(const mutate of [r=>r.source.page=2,r=>r.source.input_sha256='b'.repeat(64),r=>r.polygon[0][0]=-1,r=>r.recognition_confidence=NaN]) {const r=region('a','unmatched');mutate(r);assert.throws(()=>extract([r]));}
 assert.throws(()=>extract([region('a','姓名：甲'),region('a','姓名：乙')]));
});
test('OCR to cross-material conflict retains both actual region references',()=>{
 const a=extract([region('left','公民身份号码：110101199001010011')]).material;
 const sample={status:'succeeded',input_sha256:'b'.repeat(64),oriented_size:[600,800],regions:[{...region('right','公民身份号码：110101199001010012'),source:{page:1,input_sha256:'b'.repeat(64)}}]};
 const b=extractOcrMaterial(sample,{id:'b',type:'identity'}).material;
 const r=evaluateBatch({id:'batch',version:1,materials:[a,b]},{batchId:'batch',batchVersion:1,relations:[{id:'r',kind:'same_entity',status:'confirmed',reviewer:'fixture',reason:'independent confirmation',basisType:'reviewer_confirmation',left:{materialId:'a',role:'subject'},right:{materialId:'b',role:'subject'}}]});
 assert.equal(r.candidates[0].status,'FAIL');assert.deepEqual(r.candidates[0].evidence.map(e=>e.source.regions[0].regionId),['left','right']);assert.equal(r.candidates[0].relationshipEvidence.id,'r');assert.equal(r.overallAuthenticity,null);
});
test('empty OCR observations are validated but never emitted as fields',()=>{
 const r=extract([region('empty',''),region('label','姓名：甲')]);
 assert.equal(r.material.fields.length,1);assert.deepEqual(r.coverage.unmatchedRegionIds,['empty']);
 const bad=region('empty','');bad.polygon[0][0]=-1;assert.throws(()=>extract([bad]));
});
