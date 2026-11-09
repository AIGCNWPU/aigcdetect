import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createGeneralService} from '../src/modules/image/general/service.js';
import {expandImageUploads} from '../src/modules/image/general/archive.js';
import {zipSync} from 'fflate';
import {File} from 'node:buffer';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('busy GPU queues FIFO and resumes all jobs without failing or parallel inference',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'image-queue-'));let available=false,calls=0,active=0,maxActive=0;const order=[];
 const service=createGeneralService({root,retryMs:10,gpuSelector:async()=>{calls++;if(!available)throw Error('no_idle_gpu');return '0';},runner:async(command,args)=>{
  active++;maxActive=Math.max(maxActive,active);
  const manifest=JSON.parse(await readFile(args[args.indexOf('--manifest')+1],'utf8'));order.push(manifest[0].id);
  await sleep(10);await writeFile(args[args.indexOf('--output')+1],JSON.stringify([{id:manifest[0].id,status:'completed',verdict:'likely_ai'}]));active--;return {code:0};
 }});
 const submit=id=>service({action:'detect',id,file:{name:'a.png',mediaType:'image/png',contentBase64:'AAAA'}});
 const a=await submit('a'),b=await submit('b');
 await sleep(40);assert(calls>=2);assert.equal((await service({action:'status',jobId:a.jobId})).status,'queued');assert.equal((await service({action:'status',jobId:b.jobId})).queuePosition,2);
 available=true;
 for(let i=0;i<100;i++){if((await service({action:'status',jobId:b.jobId})).status==='completed')break;await sleep(10);}
 assert.equal((await service({action:'status',jobId:b.jobId})).status,'completed');assert.deepEqual(order,['a','b']);assert.equal(maxActive,1);
});
test('ZIP imports nested images, ignores other content, caps count and expanded bytes',async()=>{
 const zip=entries=>new File([zipSync(entries)],'images.zip');
 const entries={};for(let i=0;i<101;i++)entries[`folder/${i}.png`]=new Uint8Array([1,2,3]);
 const batch=await expandImageUploads([zip(entries)]);assert.equal(batch.images.length,100);assert.match(batch.errors.join(),/100/);
 const mixed=await expandImageUploads([zip({'folder/a.png':new Uint8Array([1]),'notes.txt':new Uint8Array([2])})]);assert.equal(mixed.images.length,1);assert.equal(mixed.images[0].name,'folder/a.png');
 const large=await expandImageUploads([zip({'big.png':new Uint8Array(20*1048576+1)})]);assert.equal(large.images.length,0);assert(large.errors.length);
 const limit=await expandImageUploads([zip({'a.png':new Uint8Array(1000)})],{remainingBytes:100});assert.equal(limit.images.length,0);assert(limit.errors.length);
 const corrupt=await expandImageUploads([new File([new Uint8Array([1,2,3])],'bad.zip')]);assert(corrupt.errors.length);
});


test('GPU memory policy preserves default and validates shared-server headroom',async()=>{
 const {gpuMemoryPolicy}=await import('../src/modules/image/documents/server/local-runtime.js');
 assert.deepEqual(gpuMemoryPolicy({}),{minimumFreeMB:24000,limitMB:null});
 assert.deepEqual(gpuMemoryPolicy({AIGC_GPU_MIN_FREE_MB:'12288',AIGC_GPU_MEMORY_LIMIT_MB:'8192'}),{minimumFreeMB:12288,limitMB:8192});
 for(const env of [{AIGC_GPU_MIN_FREE_MB:'0'},{AIGC_GPU_MIN_FREE_MB:'NaN'},{AIGC_GPU_MIN_FREE_MB:'8192',AIGC_GPU_MEMORY_LIMIT_MB:'8192'},{AIGC_GPU_MEMORY_LIMIT_MB:'-1'}])assert.throws(()=>gpuMemoryPolicy(env),/invalid_gpu_memory_policy/);
});

 test('20 MiB single-image request boundary handles large base64 without regexp stack overflow',async()=>{
 const {validateGeneralRequest}=await import('../src/modules/image/general/service.js');
 const request=n=>({action:'detect',id:'boundary',file:{name:'image.png',mediaType:'image/png',contentBase64:Buffer.alloc(n).toString('base64')}});
 assert.equal(validateGeneralRequest(request(20*1048576)).length,20*1048576);
 assert.throws(()=>validateGeneralRequest(request(20*1048576+1)));
 for(const value of ['AA=A','A===','AAAA=AAA','AAAA$AAA']){const r=request(1);r.file.contentBase64=value;assert.throws(()=>validateGeneralRequest(r));}
 });

test('shared GPUs admit busy cards with headroom and rank lower utilization first',async()=>{
 const {rankAvailableGpus}=await import('../src/modules/image/documents/server/local-runtime.js');
 const csv='0, a, 49140, 35000, 84\n1, b, 49140, 29000, 98\n2, c, 49140, 40000, 20\n3, d, 49140, 22000, 55';
 assert.deepEqual(rankAvailableGpus(csv,12000).map(r=>r[0]),['3','0']);
 assert.deepEqual(rankAvailableGpus(csv,12000,100).map(r=>r[0]),['3','0','1']);
 assert.throws(()=>rankAvailableGpus(csv,12000,101));
});
test('saved queued job retains its id and resumes through the normal worker',async()=>{
 const {mkdir}=await import('node:fs/promises');const root=await mkdtemp(path.join(tmpdir(),'image-resume-'));
 const jobId='11111111-1111-1111-1111-111111111111',dir=path.join(root,'runtime/reviews/general',jobId);
 await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'manifest.json'),JSON.stringify([{id:'restored',path:path.join(dir,'input.png')}]));
 const resumeFile=path.join(root,'resume.json');await writeFile(resumeFile,JSON.stringify([{id:'restored',jobId,status:'queued'}]));
 const service=createGeneralService({root,resumeFile,gpuSelector:async()=> '3',runner:async(_cmd,args)=>{await writeFile(args[args.indexOf('--output')+1],JSON.stringify([{id:'restored',status:'completed',verdict:'likely_ai'}]));return {code:0};}});
 let job;for(let i=0;i<100;i++){job=await service({action:'status',jobId});if(job.status==='completed')break;await sleep(10);}
 assert.equal(job.status,'completed');assert.equal(job.jobId,jobId);assert.equal(job.id,'restored');
});
