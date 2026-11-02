import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import http from 'node:http';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {validateReview,createReviewService,BODY_LIMIT} from '../src/modules/image/documents/server/review-service.js';
import {createServer} from '../scripts/serve.mjs';
import {createOpenApi} from '../scripts/openapi.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const payload=()=>({action:'review',objective:'invoice_review',jurisdiction:'CN',coreMaterialId:'core',files:[{id:'core',name:'fixture.png',materialType:'invoice',contentBase64:Buffer.from('synthetic service fixture').toString('base64')}]});
async function directory(){const base=fileURLToPath(new URL('../../runtime/replay/review-20261026/service-tests/',import.meta.url));await mkdir(base,{recursive:true});return mkdtemp(path.join(base,'run-'));}
const invalid=f=>assert.throws(()=>validateReview(f),e=>e.code==='INVALID_REVIEW'&&e.status===400);

test('review contract requires valid target/core and rejects missing/coerced identifiers',()=>{
 assert.equal(validateReview(payload()).coreMaterialId,'core');
 for(const mutation of [p=>p.objective='unknown',p=>p.jurisdiction='ID',p=>p.coreMaterialId='absent',p=>{delete p.files[0].id;delete p.coreMaterialId;},p=>{p.files[0].id=17;p.coreMaterialId=17;},p=>p.files=[]]){const p=payload();mutation(p);invalid(p);}
 invalid(null);invalid([]);
});
test('canonical base64, file names/types and byte budgets enforced before running',()=>{
 for(const name of ['../secret.png','dir/file.pdf','dir\\file.docx','null\0.png','unknown.exe']){const p=payload();p.files[0].name=name;invalid(p);}
 for(const encoded of ['','a','data:image/png;base64,YQ==','YR==','a===','%%%=', ' YQ==']){const p=payload();p.files[0].contentBase64=encoded;invalid(p);}
 const huge=payload();huge.files[0].contentBase64=Buffer.alloc(12*1024*1024+1).toString('base64');invalid(huge);
 const total=payload(),part=Buffer.alloc(9*1024*1024).toString('base64');total.files=Array.from({length:3},(_,i)=>({id:`f${i}`,name:`f${i}.pdf`,contentBase64:part}));total.coreMaterialId='f0';invalid(total);
 const duplicate=payload();duplicate.files.push({...duplicate.files[0]});invalid(duplicate);
});
test('external explanation and raw trusted relations are rejected; narrow user confirmation allowed',()=>{
 const p=payload();p.files.push({...p.files[0],id:'aux',name:'aux.docx'});p.confirmations=[{materialId:'aux',kind:'same_transaction',coreRole:'transaction',auxiliaryRole:'transaction',reason:'explicit local review'}];
 assert.equal(validateReview(p).confirmations.length,1);
 for(const mutation of [q=>q.options={explain:true},q=>q.relations=[{status:'confirmed'}],q=>q.confirmations[0].reason='',q=>q.confirmations[0].materialId='core',q=>q.confirmations[0].coreRole='unknown',q=>q.confirmations[0].amountScopeConfirmed='yes']){const q=structuredClone(p);mutation(q);invalid(q);}
});
test('service returns queued, rejects concurrent work, supports progress then partial completion',async()=>{
 let release,entered;const begun=new Promise(resolve=>entered=resolve),finish=new Promise(resolve=>release=resolve);
 const service=createReviewService({root:await directory(),runner:async(p,dir,update)=>{update({phase:'ocr',materials:[{id:'core',status:'running'}]});entered();await finish;return {status:'partial',phase:'finished',materials:[{id:'core',status:'partial',stages:{seed:{status:'failed'}}}]};}});
 const queued=await service(payload());assert.equal(queued.status,'queued');await begun;
 const current=await service({action:'status',reviewId:queued.reviewId});assert.equal(current.status,'running');assert.equal(current.phase,'ocr');
 await assert.rejects(()=>service(payload()),e=>e.code==='REVIEW_BUSY'&&e.status===429);
 release();await tick();const done=await service({action:'status',reviewId:queued.reviewId});assert.equal(done.status,'partial');assert.equal(done.materials[0].stages.seed.status,'failed');
 done.materials[0].status='edited';assert.equal((await service({action:'status',reviewId:queued.reviewId})).materials[0].status,'partial');
});
test('failure preserves progress, hides exception text, releases slot and is not reported as success',async()=>{
 const service=createReviewService({root:await directory(),runner:async(p,dir,update)=>{update({materials:[{id:'core',status:'failed',error:'parse_failed'}]});throw new Error('private internal traceback');}});
 const job=await service(payload());await tick();const result=await service({action:'status',reviewId:job.reviewId});assert.equal(result.status,'failed');assert.equal(result.materials[0].error,'parse_failed');assert.equal(result.error.code,'REVIEW_FAILED');assert.doesNotMatch(JSON.stringify(result),/private internal traceback/);
 const next=await service(payload());assert.notEqual(next.reviewId,job.reviewId);await tick();
});
test('unknown jobs rejected; completed on-disk result may be read after restart',async()=>{
 const root=await directory(),service=createReviewService({root,runner:async()=>{throw new Error('unused');}});
 await assert.rejects(()=>service({action:'status',reviewId:'../../x'}),e=>e.status===400);
 await assert.rejects(()=>service({action:'status',reviewId:'00000000-0000-4000-8000-000000000000'}),e=>e.status===404);
 const id='11111111-1111-4111-8111-111111111111';await mkdir(path.join(root,id));await writeFile(path.join(root,id,'result.json'),JSON.stringify({status:'partial',phase:'finished',materials:[]}));
 assert.equal((await service({action:'status',reviewId:id})).status,'partial');
});
test('HTTP documents enforces JSON, origin, request size, unknown job and private static boundaries',async()=>{
 const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 try {
  const call=(body,headers={})=>fetch(base+'/api/v1/image/documents',{method:'POST',headers:{'Content-Type':'application/json',...headers},body});
  assert.equal((await call('{')).status,400);assert.equal((await call('{}')).status,400);
  assert.equal((await call('{}',{'Content-Type':'text/plain'})).status,415);
  assert.equal((await call(JSON.stringify({action:'scenarios'}),{Origin:'https://untrusted.example'})).status,403);
  const directory=await call(JSON.stringify({action:'scenarios'}));assert.equal(directory.status,200);assert.equal((await directory.json()).data.profiles.length,5);
  assert.equal((await call(JSON.stringify({action:'status',reviewId:'00000000-0000-4000-8000-000000000000'}))).status,404);
  const tooLarge=await new Promise((resolve,reject)=>{const req=http.request(base+'/api/v1/image/documents',{method:'POST',headers:{'Content-Type':'application/json','Content-Length':BODY_LIMIT+1}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});assert.equal(tooLarge,413);
  for(const pathname of ['/src/modules/image/documents/server/review-plan.js','/src/modules/image/documents/python/deepseek_explainer.py','/.env.image-documents.local','/runtime/reviews/test/result.json'])assert.equal((await fetch(base+pathname)).status,404);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('OpenAPI describes two real async image endpoints and eight unchanged placeholders',()=>{
 const spec=createOpenApi(),posts=Object.values(spec.paths).map(p=>p.post).filter(Boolean);assert.equal(posts.length,10);assert.equal(posts.filter(p=>p['x-implemented']).length,2);
 const doc=spec.paths['/api/v1/image/documents'].post;for(const code of ['200','202','400','403','404','413','415','429'])assert.ok(doc.responses[code]);
 assert.equal(doc['x-production-ready'],false);assert.ok(spec.components.schemas.ReviewSubmit.properties.files.maxItems===10);assert.equal(posts.filter(p=>p.responses['501']).length,8);
});

test('all review functions are available without an account identity',()=>{
 for(const objective of ['invoice_review','procurement_review','merchant_reconciliation','research_reimbursement','identity_consistency']) {
  const p=payload();p.objective=objective;assert.equal(validateReview(p),p);
  p.role='obsolete-client-value';assert.equal(validateReview(p),p);
 }
});
test('review accepts explicit privacy and background choices and rejects invalid policy context',()=>{
 const p=payload();p.options={semanticReview:true,privacyMode:'original'};p.context={region:'CN-SH',businessDate:'2026-10-26'};
 assert.equal(validateReview(p),p);
 for(const mutate of [q=>q.options.privacyMode='public',q=>q.options.semanticReview='true',q=>q.context.region='CN-unknown',q=>q.context.businessDate='2026-02-30',q=>q.context.policySources=[{url:'https://example.invalid'}],q=>q.context.apiKey='synthetic-not-a-key',q=>q.context=[]]){
  const q=structuredClone(p);mutate(q);invalid(q);
 }
});
