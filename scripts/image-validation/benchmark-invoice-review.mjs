// Frozen, paired content-review comparison. Answers are loaded only by the separate scorer.
import http from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {extractOcrMaterial} from '../../src/modules/image/documents/server/ocr-fields.js';
import {evaluateReview} from '../../src/modules/image/documents/server/review-plan.js';
import {assessExecution} from '../../src/modules/image/documents/server/execution-assessment.js';
import {buildSemanticPackage,runSemanticReview} from '../../src/modules/image/documents/server/semantic-review.js';
const out=path.resolve(process.argv[2]||'');if(!process.argv[2])throw Error('Output directory required');
const live=process.argv.includes('--live');
const load=async p=>JSON.parse(await readFile(p,'utf8'));
const save=(p,v)=>writeFile(p,JSON.stringify(v,null,2)+'\n',{mode:0o600});
const samples=(await load(path.join(out,'ocr.json'))).samples;
if(samples.length!==8)throw Error('Wait for all 8 frozen OCR samples');
let budget;try{budget=await load(path.join(out,'budget.json'));}catch{budget={limit:50,attempts:0,requests:[]};}
async function reserve(kind){if(budget.attempts>=budget.limit)throw Error('test_budget_exhausted');const number=++budget.attempts;budget.requests.push({number,kind,time:new Date().toISOString()});await save(path.join(out,'budget.json'),budget);}
const proxy=http.createServer(async(req,res)=>{
 if(req.method!=='POST'||req.url.split('?')[0]!=='/anthropic/v1/messages'){res.writeHead(404);res.end();return;}
 try{await reserve('agent');const chunks=[];for await(const c of req)chunks.push(c);const headers={};for(const k of ['content-type','x-api-key','authorization','anthropic-version','anthropic-beta'])if(req.headers[k])headers[k]=req.headers[k];
 const result=await fetch('https://api.deepseek.com'+req.url,{method:'POST',headers,body:Buffer.concat(chunks),signal:AbortSignal.timeout(90000)});res.writeHead(result.status,{'content-type':result.headers.get('content-type')||'application/json'});for await(const chunk of result.body)res.write(chunk);res.end();
 }catch{if(!res.headersSent)res.writeHead(502);res.end();}
});
if(live){await new Promise(r=>proxy.listen(0,'127.0.0.1',r));process.env.AIGC_REVIEW_TEST_PROXY=`http://127.0.0.1:${proxy.address().port}/anthropic`;}
const summary=[];
try{for(const sample of samples){
 if(sample.status!=='succeeded')throw Error('OCR failed');
 const id=sample.sample_id,dir=path.join(out,id);await mkdir(dir,{recursive:true});
 const material=extractOcrMaterial(sample,{id,type:'unknown'}).material;
 // Identical observed OCR for all three methods; no PDF text or gold fields injected.
 material.textBlocks=sample.regions.map(r=>({id:r.region_id,text:r.observed_text,confidence:r.recognition_confidence,page:1}));
 const batch={id:'benchmark-'+id,version:1,materials:[material]};
 const review=evaluateReview(batch,{coreMaterialId:id,objective:'invoice_review'});
 review.executionAssessment=assessExecution({batch,review,materials:batch.materials});
 const pkg=buildSemanticPackage({batch,review,materials:batch.materials,objective:'invoice_review',privacyMode:'original'});
 await save(path.join(dir,'local.json'),{batch,review});await save(path.join(dir,'package.json'),pkg);
 if(!live){console.log(JSON.stringify({id,fields:material.fields.length,items:pkg.items.length,losses:pkg.losses}));continue;}
 const sender=async request=>{await reserve('direct');const response=await fetch('https://api.deepseek.com/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.DEEPSEEK_API_KEY}`},body:JSON.stringify({model:'deepseek-flash',messages:request.messages,response_format:{type:'json_object'},max_tokens:6000,thinking:{type:'disabled'},temperature:0}),signal:AbortSignal.timeout(90000)});if(!response.ok)throw Error('provider_failed');const body=await response.json();await save(path.join(dir,'direct-usage.json'),body.usage);return JSON.parse(body.choices[0].message.content);};
 for(const engine of ['direct','claude-agent-sdk']){
 const start=Date.now();const result=await runSemanticReview(pkg,{enabled:true,engine,model:'deepseek-flash',...(engine==='direct'?{sender}:{}),outputDir:path.join(dir,engine),timeoutMs:180000});
 await save(path.join(dir,engine+'-result.json'),result);summary.push({id,engine,status:result.status,reason:result.reason,seconds:(Date.now()-start)/1000,verdicts:result.items.map(x=>x.verdict)});console.log(JSON.stringify(summary.at(-1)));await save(path.join(out,'progress.json'),summary);
 }
 if(budget.attempts>=50)break;
}}finally{if(live){proxy.closeAllConnections();proxy.close();}console.log('HTTP attempts:',budget.attempts);}
