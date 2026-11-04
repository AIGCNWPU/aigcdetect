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
 const large=await expandImageUploads([zip({'big.png':new Uint8Array(11*1048576)})]);assert.equal(large.images.length,0);assert(large.errors.length);
 const limit=await expandImageUploads([zip({'a.png':new Uint8Array(1000)})],{remainingBytes:100});assert.equal(limit.images.length,0);assert(limit.errors.length);
 const corrupt=await expandImageUploads([new File([new Uint8Array([1,2,3])],'bad.zip')]);assert(corrupt.errors.length);
});


test('GPU memory policy preserves default and validates shared-server headroom',async()=>{
 const {gpuMemoryPolicy}=await import('../src/modules/image/documents/server/local-runtime.js');
 assert.deepEqual(gpuMemoryPolicy({}),{minimumFreeMB:24000,limitMB:null});
 assert.deepEqual(gpuMemoryPolicy({AIGC_GPU_MIN_FREE_MB:'12288',AIGC_GPU_MEMORY_LIMIT_MB:'8192'}),{minimumFreeMB:12288,limitMB:8192});
 for(const env of [{AIGC_GPU_MIN_FREE_MB:'0'},{AIGC_GPU_MIN_FREE_MB:'NaN'},{AIGC_GPU_MIN_FREE_MB:'8192',AIGC_GPU_MEMORY_LIMIT_MB:'8192'},{AIGC_GPU_MEMORY_LIMIT_MB:'-1'}])assert.throws(()=>gpuMemoryPolicy(env),/invalid_gpu_memory_policy/);
});
